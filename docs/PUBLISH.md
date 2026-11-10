# Перша публікація коду на GitHub

1. Увійдіть до GitHub і відкрийте [створення репозиторію](https://github.com/new). Виберіть назву, наприклад `studentwatch`, і видимість. Залиште репозиторій порожнім, щоб першим комітом був ваш локальний код. Скопіюйте HTTPS-адресу з екрана Quick Setup.
2. Перейдіть у проєкт і перегляньте файли, які Git бачить для першого коміту.

   ```powershell
   Set-Location 'C:\Users\User\Documents\ChatGPT\StudentWatch'
   git status --short --untracked-files=all
   ```

   Переконайтеся, що до списку не потрапили секрети, справжні учнівські записи, дипломи, база даних, `.venv`, `node_modules` або інсталятор.

3. Додайте файли, перегляньте вміст майбутнього коміту й створіть його.

   ```powershell
   git add -- .
   git diff --cached --stat
   git diff --cached --check
   git commit -m "Створити прототип Поступу 0.1.0"
   ```

4. Назвіть гілку `main` і додайте HTTPS-адресу нового репозиторію. Замініть `YOUR-LOGIN` на свій логін, а назву репозиторію — на вибрану на GitHub.

   ```powershell
   git branch -M main
   git remote add origin https://github.com/YOUR-LOGIN/studentwatch.git
   git remote -v
   git push -u origin main
   ```

   Якщо Git Credential Manager відкриє браузер, підтвердьте вхід до GitHub у ньому.

5. Оновіть сторінку репозиторію й перевірте гілку `main`, README та перший коміт. Коли завершите ручну перевірку інсталятора і захочете позначити версію, створіть і відправте тег.

   ```powershell
   git tag -a v0.1.0 -m "Поступ 0.1.0"
   git push origin v0.1.0
   ```

   Для поширення інсталятора окремо створіть GitHub Release з цього тегу та додайте `Поступ_0.1.0_x64-setup.exe` із папки `bundle/nsis` як вкладення.

[Офіційна інструкція GitHub](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)
