#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::time::Duration;

use keyring::Entry;
use reqwest::{header, Method, Url};
use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Response;
use tauri::{State, WebviewWindowBuilder};
use tokio::sync::Mutex;

const SESSION_COOKIE: &str = "postup_session";
const API_ORIGIN: &str = match option_env!("POSTUP_API_ORIGIN") {
    Some(value) => value,
    None => "http://127.0.0.1:8000",
};

struct Transport {
    origin: Url,
    http: reqwest::Client,
    session: Mutex<Entry>,
}

#[derive(Serialize)]
struct ApiResponse {
    status: u16,
    data: Option<Value>,
}

fn valid_origin(url: &Url) -> bool {
    let secure = url.scheme() == "https"
        || (url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1" | "localhost")));
    secure
        && url.host().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none()
}

fn forget(entry: &Entry) -> Result<(), &'static str> {
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("storage"),
    }
}

#[tauri::command]
async fn forget_session(transport: State<'_, Transport>) -> Result<(), &'static str> {
    let entry = transport.session.lock().await;
    forget(&entry)
}

#[tauri::command]
fn api_origin(transport: State<'_, Transport>) -> String {
    transport.origin.origin().ascii_serialization()
}

#[tauri::command]
async fn api_request(
    transport: State<'_, Transport>,
    path: String,
    method: String,
    body: Option<Value>,
    csrf: Option<String>,
) -> Result<ApiResponse, &'static str> {
    let response = send(&transport, &path, &method, body, csrf).await?;
    let status = response.status().as_u16();
    let bytes = response.bytes().await.map_err(|_| "network")?;
    Ok(ApiResponse {
        status,
        data: serde_json::from_slice(&bytes).ok(),
    })
}

#[tauri::command]
async fn api_download(
    transport: State<'_, Transport>,
    path: String,
) -> Result<Response, &'static str> {
    const MAX_BYTES: usize = 10 * 1024 * 1024;
    if !path.starts_with("/api/achievements/") || !path.ends_with("/download/") {
        return Err("request");
    }
    let mut response = send(&transport, &path, "GET", None, None).await?;
    match response.status().as_u16() {
        200 => (),
        401 => return Err("session"),
        403 | 404 => return Err("missing"),
        _ => return Err("network"),
    }
    let length = response
        .content_length()
        .filter(|size| *size <= MAX_BYTES as u64)
        .ok_or("request")?;
    let mut bytes = Vec::with_capacity(length as usize);
    while let Some(chunk) = response.chunk().await.map_err(|_| "network")? {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err("request");
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(Response::new(bytes))
}

async fn send(
    transport: &Transport,
    path: &str,
    method: &str,
    body: Option<Value>,
    csrf: Option<String>,
) -> Result<reqwest::Response, &'static str> {
    let (path, query) = path
        .split_once('?')
        .map_or((path, None), |(path, query)| (path, Some(query)));
    if !path.starts_with("/api/")
        || !path.ends_with('/')
        || !path
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-'))
    {
        return Err("request");
    }
    let method = match method {
        "GET" => Method::GET,
        "POST" => Method::POST,
        "PUT" => Method::PUT,
        "PATCH" => Method::PATCH,
        "DELETE" => Method::DELETE,
        _ => return Err("request"),
    };
    let mut url = transport.origin.clone();
    url.set_path(path);
    if let Some(query) = query {
        if method != Method::GET || query.len() > 4096 {
            return Err("request");
        }
        url.set_query(Some(query));
    }
    let mut request = transport
        .http
        .request(method, url)
        .header(
            header::ORIGIN,
            transport.origin.origin().ascii_serialization(),
        )
        .header(header::ACCEPT, "application/json");
    if transport.origin.scheme() == "https" && path == "/api/session/" {
        request = request.timeout(Duration::from_secs(90));
    }
    if path.ends_with("/download/") {
        request = request.timeout(Duration::from_secs(60));
    }
    if let Some(data) = body {
        request = request.json(&data);
    }
    if let Some(token) = csrf {
        request = request.header("X-CSRFToken", token);
    }

    let entry = transport.session.lock().await;
    match entry.get_password() {
        Ok(key) => request = request.header(header::COOKIE, format!("{SESSION_COOKIE}={key}")),
        Err(keyring::Error::NoEntry) => (),
        Err(_) => return Err("storage"),
    }
    let response = request.send().await.map_err(|_| "network")?;
    if let Some(cookie) = response
        .cookies()
        .find(|cookie| cookie.name() == SESSION_COOKIE)
    {
        if cookie.value().is_empty() {
            forget(&entry)?;
        } else {
            entry.set_password(cookie.value()).map_err(|_| "storage")?;
        }
    }
    Ok(response)
}

fn main() {
    let origin = Url::parse(API_ORIGIN).expect("invalid POSTUP_API_ORIGIN");
    assert!(
        valid_origin(&origin),
        "POSTUP_API_ORIGIN requires HTTPS or local HTTP"
    );
    let credential = Entry::new("ua.postup.desktop", &origin.origin().ascii_serialization())
        .expect("could not open Windows Credential Manager");
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(8))
        .build()
        .expect("could not initialize HTTPS client");

    tauri::Builder::default()
        .manage(Transport {
            origin,
            http,
            session: Mutex::new(credential),
        })
        .invoke_handler(tauri::generate_handler![
            api_request,
            api_download,
            api_origin,
            forget_session
        ])
        .setup(|app| {
            let config = &app.config().app.windows[0];
            let dev_origin = if cfg!(debug_assertions) {
                app.config().build.dev_url.as_ref().map(|url| url.origin())
            } else {
                None
            };
            WebviewWindowBuilder::from_config(app, config)?
                .on_navigation(move |url| {
                    (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
                        || dev_origin
                            .as_ref()
                            .is_some_and(|origin| *origin == url.origin())
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to open Postup");
}
