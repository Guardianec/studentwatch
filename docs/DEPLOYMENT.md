# Підготовка «Поступу» 0.2.0 до онлайн-пілоту

Для Render і Neon скористайтеся готовою конфігурацією й [кроками безкоштовного пілоту](PILOT.md).

Одна HTTPS-адреса обслуговує учнівський сайт, Django API та адміністративну панель. Учнівський браузер звертається до `/api/` на тому самому origin. Windows-програма містить локальний інтерфейс і надсилає запити HTTPS через Tauri. PostgreSQL працює незалежно від комп’ютера вчителя.

## 1. Налаштування сервера

Створіть приватну базу PostgreSQL та окремого користувача з правами на її схему. Обмежте доступ до порту БД сервером Django. Заповніть змінні в середовищі процесу або в локальному `.env` на сервері. Вихідний перелік є в [прикладі конфігурації](../.env.example).

| Змінна | Приклад або призначення |
|---|---|
| `POSTUP_MODE` | `production` вимагає PostgreSQL, HTTPS і явних хостів. |
| `DJANGO_SECRET_KEY` | Унікальний секрет. Згенеруйте локально командою `python -c "import secrets; print(secrets.token_urlsafe(64))"` і перенесіть у сховище секретів. Зберігайте його між перезапусками. |
| `POSTUP_ALLOWED_HOSTS` | Точні імена хостів через кому, наприклад `postup.example.org`. |
| `POSTUP_TRUSTED_ORIGINS` | Точні HTTPS origins через кому, якщо вони потрібні для CSRF. Для одного origin зі збереженим `Host` список може бути порожнім. |
| `POSTUP_TRUSTED_PROXY_IPS` | IP останнього довіреного проксі, наприклад `127.0.0.1`. |
| `POSTUP_DB_NAME`, `POSTUP_DB_USER`, `POSTUP_DB_PASSWORD` | База й окремі облікові дані для Django. |
| `POSTUP_DB_HOST`, `POSTUP_DB_PORT`, `POSTUP_DB_SSLMODE` | Адреса БД та режим TLS. Production за замовчуванням вимагає TLS. Для перевірки імені сервера використайте `verify-full` і CA від провайдера. |

З кореня проєкту виконайте в середовищі сервера з Python 3.12+:

```sh
python -m pip install -r server/requirements.txt
python server/manage.py check --deploy
python server/manage.py migrate --noinput
python server/manage.py collectstatic --noinput
python server/manage.py createsuperuser
cd server
waitress-serve --listen=127.0.0.1:8000 --url-scheme=https --max-request-body-size=65536 postup.wsgi:application
```

Запускайте Waitress як керований процес із перезапуском після збою. `--url-scheme=https` застосовуйте за проксі, що пропускає до Waitress лише запити з TLS. Зберігайте `Host` і встановлюйте `X-Real-IP` заново на довіреному проксі. Django бере IP для обмеження спроб лише з довіреного проксі або TCP-з’єднання. Порт Waitress залиште приватним. [Waitress за reverse proxy](https://docs.pylonsproject.org/projects/waitress/en/stable/reverse-proxy.html)

## 2. Учнівський сайт і HTTPS

Зберіть сайт із кореня проєкту командами `npm ci` та `npm run build`. На одному HTTPS origin налаштуйте маршрути:

- `/api/` і `/admin/` проксіюються до Waitress із початковим шляхом та хостом. Проксі перезаписує `X-Real-IP` адресою клієнта, визначеною з довіреного джерела.
- `/static/` віддається з `server/staticfiles/`.
- `/` та `/assets/` віддаються з `dist/`. Для HTML використайте політику кешування, яка дозволяє браузеру підхопити нову збірку.

HTTP перенаправляється на HTTPS на зовнішньому проксі. Приклад фрагмента всередині HTTPS-сервера Nginx:

```nginx
root /srv/postup/dist;
location ~ ^/(api|admin)/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    client_max_body_size 64k;
}
location /static/ {
    alias /srv/postup/server/staticfiles/;
}
location / {
    try_files $uri $uri/ /index.html;
}
```

Перевірте HTTPS, `GET /api/health/`, вхід в `/admin/` та завантаження його стилів. У production cookie сесії має атрибути Secure, HttpOnly і SameSite=Lax. Сайт працює зі своїм origin, тому CORS для сесій не потрібен. Заплануйте резервне копіювання PostgreSQL і пробне відновлення. Регулярно запускайте `python server/manage.py clearsessions` та прибирайте застарілі лічильники командою `python server/manage.py shell -c "from datetime import timedelta; from django.utils import timezone; from postup.models import RateBucket; RateBucket.objects.filter(expires_at__lt=timezone.now()-timedelta(days=1)).delete()"`.

HSTS застосовується до хоста застосунку. `check --deploy` попереджає про вимкнені includeSubDomains і preload. Рішення щодо цих параметрів залежить від вибраного домену та готовності його піддоменів до HTTPS.

## 3. Windows-збірка для пілоту

Задайте адреси в PowerShell перед збіркою. Використайте штатний HTTPS origin і перевірте адресу в розділі «Налаштування» встановленої програми.

```powershell
$env:POSTUP_API_ORIGIN = 'https://postup.example.org'
$env:VITE_STUDENT_ORIGIN = 'https://postup.example.org'
npm.cmd ci
npm.cmd run tauri -- build --target x86_64-pc-windows-msvc
```

Клієнт приймає HTTPS для віддаленого сервера й HTTP тільки для loopback. Облікові дані відокремлені за адресою API в Windows Credential Manager. Запрошення містить код у фрагменті адреси сайту, а перевірка коду й подання заявки відбуваються через POST. Тестова збірка з адресою loopback призначена для локальної перевірки.

## 4. Облікові записи та відновлення доступу

Увійдіть у `/admin/` створеним адміністратором. У розділі користувачів додайте обліковий запис із ПІБ, логіном у нижньому регістрі та роллю «Учитель». Адміністративні ознаки залиште вимкненими для вчителів. Учень реєструється на сайті з роллю «Учень». Сайт збирає ПІБ, логін і пароль.

За втрати доступу адміністратор спершу перевіряє особу через установлений канал школи. Виконайте `python server/manage.py changepassword <логін>` і дайте власнику облікового запису ввести новий пароль приватно в контрольованій сесії. Зміна пароля робить попередні сесії недійсними. Для блокування облікового запису зніміть «Активний» у Django Admin. Паролі не надсилаються в листах чи повідомленнях.

До онлайн-пілоту залишаються вибір хостингу й домену, налаштування TLS і резервних копій, перевірка маршрутизації та повторна збірка Windows з адресою пілоту. Для поширення інсталятора заплануйте цифровий підпис і тест на чистій Windows з WebView2 та без нього. [Django · перевірки перед розгортанням](https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/)
