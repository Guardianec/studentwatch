import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setTimeout as wait } from 'node:timers/promises'

const require = createRequire(new URL('../../.qa/package.json', import.meta.url))
const axe = require('axe-core')
const { chromium } = require('playwright-core')
const before = process.argv.includes('--before')
const output = resolve('.qa', before ? '0.4.1-before' : '0.4.1-after')
await mkdir(output, { recursive: true })
const env = { ...process.env, POSTUP_MODE: 'development', POSTUP_SERVE_WEB: '1', POSTUP_SQLITE_PATH: resolve(output, 'qa-' + randomUUID() + '.sqlite3') }
env.POSTUP_DATABASE_URL = ''
env.POSTUP_DB_NAME = ''
const python = process.env.POSTUP_QA_PYTHON || resolve('.venv/Scripts/python.exe')
const port = before ? 18140 : 18141
const base = 'http://127.0.0.1:' + port
const pass = 'QA-' + randomUUID()
const manage = (...args) => execFileSync(python, ['server/manage.py', ...args], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] })
manage('migrate', '--noinput')
env.POSTUP_QA_PASSWORD = pass
manage('shell', '-c', await readFile(new URL('./seed.py', import.meta.url), 'utf8'))
delete env.POSTUP_QA_PASSWORD
const server = spawn(python, ['-m','waitress','--listen=127.0.0.1:' + port,'postup.wsgi:application'], { cwd: resolve('server'), env, windowsHide: true, stdio: 'inherit' })
let browser, native, desktop
try {
  let ready = false
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + '/api/health/', {signal: AbortSignal.timeout(500)})).ok) { ready = true; break } } catch {}
    await wait(200)
  }
  if (!ready) throw new Error('Django start failed')
  browser = await chromium.launch({ executablePath: process.env.POSTUP_QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
  async function page(teacher, width) {
    const p = await browser.newPage({ viewport: {width, height: 940} })
    p.setDefaultTimeout(5000)
    if (before) await p.route(/^http:\/\/127\.0\.0\.1:\d+\/(?!api\/)/, async route => {
      const path = new URL(route.request().url()).pathname
      await route.fulfill({path: resolve(output, 'dist', path === '/' ? 'index.html' : path.slice(1))})
    })
    if (teacher) await p.addInitScript(() => {
      globalThis.isTauri = true
      globalThis.__TAURI_INTERNALS__ = { invoke: async (cmd, args) => {
        if (cmd === 'api_origin') return location.origin
        if (cmd === 'forget_session') return
        if (cmd !== 'api_request') throw new Error(cmd)
        const response = await fetch(args.path, {
          method: args.method, headers: { 'Content-Type': 'application/json', 'X-CSRFToken': args.csrf ?? '' },
          body: args.body ? JSON.stringify(args.body) : undefined
        })
        return { status: response.status, data: await response.json() }
      } }
    })
    await p.goto(base)
    return p
  }
  async function login(p, username) {
    await p.getByLabel('Логін').fill(username)
    await p.getByLabel('Пароль', {exact:true}).fill(pass)
    await p.getByRole('button', {name:'Увійти',exact:true}).click()
  }
  const snap = (p, name) => p.screenshot({
    path: resolve(output, name + '.png'), animations:'disabled',
    fullPage: name === 'student-editor'
  })
  const click = (p, name, role='button') => p.getByRole(role,{name,exact:typeof name === 'string'}).first().click()
  const heading = (p, name) => p.getByRole('heading',{name,exact:true}).first().waitFor()
  let teacher
  if (process.argv.includes('--native')) {
    const executable = resolve('src-tauri/target/x86_64-pc-windows-msvc/release/postup.exe')
    desktop = spawn(executable, [], { windowsHide: true, env: { ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: resolve(output, 'webview-' + randomUUID()),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=19341 --remote-debugging-address=127.0.0.1' } })
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch('http://127.0.0.1:19341/json/version', {signal: AbortSignal.timeout(300)})).ok) {
          native = await chromium.connectOverCDP('http://127.0.0.1:19341')
          break
        }
      } catch {}
      await wait(200)
    }
    if (!native) throw new Error('WebView2 not available')
    teacher = native.contexts()[0].pages()[0]
    await teacher.getByLabel('Логін').waitFor()
  } else teacher = await page(true, 1360)
  const pupil = await page(false, 390)
  await pupil.getByLabel('Логін').waitFor()
  await snap(pupil,'student-sign-in')
  await click(pupil,'Створити обліковий запис')
  await heading(pupil,'Створити обліковий запис')
  await snap(pupil,'student-register')
  await click(pupil,'Уже є обліковий запис? Увійти')
  await login(teacher, 'qa_teacher')
  await login(pupil, 'qa_student')
  if (before) {
    await heading(teacher,'Огляд')
    await heading(teacher,'Група дослідників')
    await snap(teacher,'teacher-overview')
    await click(teacher,'Групи','link')
    await heading(teacher,'Учасники')
    await snap(teacher,'teacher-groups')
    await click(teacher,'Софія Приклад')
    await heading(teacher,'Портфоліо')
    await snap(teacher,'teacher-profile-portfolio')
    await teacher.keyboard.press('Escape')
    await click(teacher,/Заявки/,'link')
    await heading(teacher,'Заявки')
    await snap(teacher,'teacher-applications')
    await click(teacher,'На перевірці','link')
    await click(teacher,/Софія Приклад.*Міський/)
    await snap(teacher,'teacher-review')
    await teacher.locator('.teacher-record-panel').getByRole('button',{name:'Попросити уточнення'}).waitFor()
    await click(teacher,'Попросити уточнення')
    await teacher.getByRole('textbox',{name:'Коментар для учня'}).fill('Уточніть етап.')
    await click(teacher,'Зберегти рішення')
    await teacher.getByRole('status').filter({hasText:'Рішення збережено.'}).waitFor()
    await click(teacher,'Налаштування','link')
    await heading(teacher,'Налаштування')
    await snap(teacher,'teacher-settings')
    await heading(pupil,'Мої групи')
    await snap(pupil,'student-home')
    await click(pupil,'Мій профіль')
    await heading(pupil,'Портфоліо')
    await snap(pupil,'student-profile')
    await click(pupil,'Мої досягнення')
    await click(pupil,/Міський/)
    await heading(pupil,'Міський турнір з математики')
    await snap(pupil,'student-achievement')
    await click(pupil,'Додати підтвердження')
    await snap(pupil,'student-evidence')
    await click(pupil,'До списку')
    await heading(pupil,'Мої досягнення')
    await snap(pupil,'student-portfolio')
    await click(pupil,'Мої групи')
    const start = performance.now()
    await click(pupil,'Мої досягнення')
    await click(pupil,'Нове досягнення')
    await heading(pupil,'Нове досягнення')
    await pupil.getByRole('combobox',{name:'Конкурс',exact:true}).selectOption({label:'МАН'})
    await pupil.getByLabel('Сезон або рік конкурсу').fill('2026/27')
    await pupil.getByLabel('Назва етапу, якщо відома').fill('Міський етап QA')
    await click(pupil,'Далі')
    await click(pupil,'Далі')
    await pupil.getByRole('checkbox',{name:/Група дослідників/}).check()
    await click(pupil,'Подати на перевірку')
    await pupil.getByText('Результат подано вибраним групам.', {exact:true}).waitFor()
    console.log('Baseline scripted submission (ms): ' + Math.round(performance.now() - start))
    await click(pupil,'До списку')
    await click(pupil,'Нове досягнення')
    await heading(pupil,'Нове досягнення')
    await snap(pupil,'student-editor')
    await click(pupil,/Сповіщення/)
    await heading(pupil,'Сповіщення')
    await snap(pupil,'student-notifications')
    await pupil.getByRole('listitem').filter({hasText:'Уточніть етап.'}).getByRole('button',{name:'Відкрити запис'}).click()
    await click(pupil,'Виправити')
    await click(pupil,'Підтвердження й доступ')
    await snap(pupil,'student-revision')
  }
  if (!before) {
    const axeCheck = async (p, label) => {
      await p.locator('.view-enter').evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {}))) })
      await p.evaluate(axe.source)
      const issues = await p.evaluate(async () => (await axe.run({runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa']})).violations)
      assert.deepEqual(issues.map(x => [x.id, x.nodes.map(n => n.target)]), [], label)
      assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label + ' overflow')
    }
    const perf = {}
    let start = performance.now()
    await heading(teacher, 'Академічний огляд')
    await teacher.getByRole('heading', {name:'Останні досягнення'}).waitFor()
    perf.overview = Math.round(performance.now() - start)
    await snap(teacher, 'teacher-overview')
    await axeCheck(teacher, 'overview desktop')
    start = performance.now()
    await click(teacher,'Учні','link')
    await teacher.getByText('Учнів · 91', {exact:true}).waitFor()
    perf.directory = Math.round(performance.now() - start)
    await snap(teacher,'teacher-directory')
    await teacher.getByRole('searchbox',{name:'Ім’я учня'}).fill('Софія Приклад')
    await click(teacher,'Знайти')
    await click(teacher,'Софія Приклад','link')
    await heading(teacher,'Академічне портфоліо')
    await teacher.getByRole('link',{name:'Міський турнір з математики'}).waitFor()
    await snap(teacher,'teacher-student')
    await click(teacher,'Назад','link')
    await teacher.getByText('Учнів · 1', {exact:true}).waitFor()
    assert.equal(await teacher.getByRole('searchbox').inputValue(),'Софія Приклад')
    start = performance.now()
    await teacher.locator('#navigation').getByRole('link',{name:'Досягнення'}).click()
    await teacher.getByText(/Досягнень 363/).waitFor()
    perf.library = Math.round(performance.now() - start)
    await snap(teacher,'teacher-library')
    await teacher.getByRole('searchbox').fill('Софія Диплом')
    await click(teacher,'Знайти')
    await teacher.getByText(/Досягнень 2/).waitFor()
    start = performance.now()
    await teacher.locator('#navigation').getByRole('link',{name:/Вхідні/}).click()
    await teacher.getByText('Подань за групами · 1', {exact:true}).waitFor()
    perf.inbox = Math.round(performance.now() - start)
    await snap(teacher,'teacher-inbox')
    await click(teacher,'Міський турнір з математики','link')
    await heading(teacher,'Міський турнір з математики')
    await snap(teacher,'teacher-review')
    await click(teacher,'Попросити уточнення')
    await teacher.getByRole('textbox',{name:'Коментар для учня'}).fill('Додайте уточнений етап.')
    await click(teacher,'Зберегти рішення')
    await teacher.getByRole('status').filter({hasText:'Рішення збережено.'}).waitFor()
    await click(teacher,'До вхідних','link')
    await teacher.getByText('Подань за групами · 0', {exact:true}).waitFor()
    await click(teacher,'Заявки до груп')
    await teacher.getByText('Марко Приклад',{exact:true}).waitFor()
    await snap(teacher,'teacher-applications')
    await click(teacher,'Прийняти')
    await teacher.getByText('Заявок · 0',{exact:true}).waitFor()
    await teacher.locator('#navigation').getByRole('link',{name:'Групи',exact:true}).click()
    await click(teacher,'Група дослідників','link')
    await heading(teacher,'Учні групи')
    await snap(teacher,'teacher-group')
    await click(teacher,'Досягнення групи')
    await heading(teacher,'Досягнення групи')
    await snap(teacher,'teacher-group-achievements')
    await click(teacher,'Керування групою')
    await click(teacher,'Створити запрошення')
    await teacher.getByLabel('Код запрошення').waitFor()
    await click(teacher,'Відкликати')
    await teacher.getByRole('dialog').getByRole('button',{name:'Відкликати запрошення'}).click()
    await teacher.getByRole('button',{name:'Створити запрошення'}).waitFor()
    await heading(pupil,'Мій академічний шлях')
    await heading(pupil,'Потрібна ваша увага')
    await snap(pupil,'student-home-mobile')
    await click(pupil,'Групи','link')
    await heading(pupil,'Мої групи')
    await snap(pupil,'student-groups')
    await click(pupil,'Профіль','link')
    await heading(pupil,'Мій профіль')
    await snap(pupil,'student-profile')
    await click(pupil,'Головна','link')
    await heading(pupil,'Мій академічний шлях')
    await heading(pupil,'Потрібна ваша увага')
    await axeCheck(pupil,'home mobile')
    await pupil.setViewportSize({width:1280,height:940})
    await snap(pupil,'student-home-desktop')
    await pupil.setViewportSize({width:320,height:880})
    await axeCheck(pupil,'home 320px')
    await pupil.setViewportSize({width:390,height:940})
    start = performance.now()
    await click(pupil,'Додати досягнення','link')
    await pupil.getByRole('combobox',{name:'Конкурс',exact:true}).selectOption({label:'МАН'})
    await pupil.getByLabel('Назва етапу, якщо відома').fill('Міський етап QA')
    await pupil.getByRole('checkbox',{name:/Група дослідників/}).check()
    await click(pupil,'Подати досягнення')
    await pupil.getByText('Результат подано вибраним групам.',{exact:true}).waitFor()
    perf.submission = Math.round(performance.now()-start)
    assert.match(await pupil.evaluate(() => location.hash), /^#\/portfolio\/[\w-]{36}\?/)
    await pupil.reload()
    await heading(pupil,'МАН')
    await snap(pupil,'student-achievement')
    await click(pupil,'Додати підтвердження')
    await snap(pupil,'student-evidence')
    const pdf = execFileSync(python, ['-c', 'import sys; from pypdf import PdfWriter; p=PdfWriter(); p.add_blank_page(100,100); p.write(sys.stdout.buffer)'], {windowsHide: true})
    await pupil.locator('#achievement-file').setInputFiles({name:'Синтетичний документ.pdf',mimeType:'application/pdf',buffer:pdf})
    await click(pupil,'Зберегти матеріали')
    await pupil.getByText('Синтетичний документ.pdf',{exact:true}).first().waitFor()
    await click(pupil,'Портфоліо','link')
    await heading(pupil,'Портфоліо')
    await pupil.getByRole('link',{name:'Наукова конференція учнів'}).waitFor()
    await snap(pupil,'student-portfolio')
    await axeCheck(pupil,'portfolio mobile')
    await click(pupil,/Сповіщення/,'link')
    await pupil.getByText('Додайте уточнений етап.',{exact:true}).waitFor({timeout:20000})
    await snap(pupil,'student-notifications')
    await click(pupil,'Відкрити запис','link')
    await click(pupil,'Виправити')
    await pupil.getByLabel('Назва етапу, якщо відома').fill('Уточнений етап')
    await pupil.getByLabel('Що виправлено').fill('Звірено з програмою турніру.')
    await snap(pupil,'student-revision')
    await axeCheck(pupil,'editor mobile')
    await pupil.getByRole('button',{name:'Повторно подати'}).scrollIntoViewIfNeeded()
    await snap(pupil,'student-editor-recipients')
    await click(pupil,'Повторно подати')
    await pupil.getByText('Результат подано вибраним групам.',{exact:true}).waitFor()
    await click(pupil,'Головна','link')
    await click(pupil,'Додати досягнення','link')
    await heading(pupil,'Додати досягнення')
    await pupil.getByRole('combobox',{name:'Конкурс',exact:true}).selectOption({label:'МАН'})
    await pupil.getByRole('checkbox',{name:/Група дослідників/}).check()
    await snap(pupil,'student-editor')
    await axeCheck(pupil,'new editor mobile')
    if (!native) {
      await teacher.setViewportSize({width:760,height:700})
      await teacher.getByRole('link',{name:'Поступ',exact:true}).click()
      await heading(teacher,'Академічний огляд')
      await axeCheck(teacher,'overview narrow')
      await snap(teacher,'teacher-overview-narrow')
    }
    if (native) {
      await teacher.locator('#navigation').getByRole('link',{name:/Вхідні/}).click()
      await teacher.getByRole('combobox',{name:'Причина'}).selectOption('revised')
      await click(teacher,'Міський турнір з математики','link')
      await teacher.getByText('Уточнений етап',{exact:false}).first().waitFor()
      await snap(teacher,'teacher-resubmission')
      await click(teacher,'Підтвердити')
      await teacher.getByRole('textbox',{name:'Пояснення підстави'}).fill('Синтетичний протокол № 7.')
      await click(teacher,'Зберегти рішення')
      await teacher.getByRole('status').filter({hasText:'Рішення збережено.'}).waitFor()
      await click(teacher,'До вхідних','link')
      await teacher.getByRole('combobox',{name:'Причина'}).selectOption('materials')
      await click(teacher,'МАН','link')
      const pendingDownload = teacher.waitForEvent('download')
      await click(teacher,/Завантажити Синтетичний документ/)
      const download = await pendingDownload
      assert.equal(download.suggestedFilename(),'Синтетичний документ.pdf')
      await click(teacher,'Позначити матеріали переглянутими')
      await teacher.getByRole('status').filter({hasText:'Матеріали позначено переглянутими.'}).waitFor()
      await teacher.locator('#navigation').getByRole('link',{name:'Налаштування'}).click()
      await heading(teacher,'Налаштування')
      await snap(teacher,'teacher-settings')
    }
    await pupil.emulateMedia({reducedMotion:'reduce'})
    assert.equal(await pupil.locator('.view-enter').evaluate(el => getComputedStyle(el).animationName), 'none')
    console.log(JSON.stringify(perf))
  }
  console.log('Screenshots saved in ' + output)
} finally {
  await native?.close()
  desktop?.kill()
  await browser?.close()
  server.kill()
}
