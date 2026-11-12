# Оновлення «Поступу» на GitHub

Відкрийте PowerShell у репозиторії й перевірте гілку, адресу та файли. Поточний remote `origin` вказує на `Guardianec/studentwatch`.

```powershell
Set-Location 'C:\Users\User\Documents\ChatGPT\StudentWatch'
git status --short --branch
git remote -v
git diff --check
```

Перегляньте diff та нові файли. У коміт мають потрапити вихідний код, міграція, тести й документація. Секрети, база, дипломи, резервні копії та інсталятор зберігаються поза Git. Якщо Render підключено до `main`, перед відправленням перевірте параметри Neon і політику автодеплою. [Оновлення онлайн-пілоту](PILOT.md#оновлення-наявного-сервісу)

Для прямого оновлення `main` виконайте:

```powershell
git add -- .
git diff --cached --stat
git diff --cached --check
git commit -m "Додати профілі, досягнення та приватні вкладення у 0.3.0"
git push origin main
```

Якщо `main` захищена, створіть гілку `git switch -c codex/postup-0.3.0` перед комітом, відправте її командою `git push -u origin codex/postup-0.3.0` й відкрийте Pull Request у `main`. Злийте після зеленого **Pilot checks**. Якщо Git Credential Manager відкриє браузер, підтвердьте вхід до GitHub. [Репозиторій](https://github.com/Guardianec/studentwatch) · [GitHub Actions](https://github.com/Guardianec/studentwatch/actions)

Після тестового онлайн-розгортання за потреби створіть тег `v0.3.0` і GitHub Release. Додайте зібраний із реальною HTTPS-адресою інсталятор як вкладення до Release. Перед оприлюдненням перевірте, кому має бути доступний інсталятор. [Керування GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
