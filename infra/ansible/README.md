# Тестовый стенд Paybull на VPS

Один VPS на Ubuntu 26.04, Docker Compose:

- **backend** — образ из `Dockerfile` в корне репозитория, собирается на сервере из git;
- **Postgres 16** — только во внутренней сети compose;
- **VictoriaLogs** — порт `9428` только на `127.0.0.1` сервера;
- **Caddy** — HTTPS (Let's Encrypt): API на одном поддомене, фронт (статика SPA) на другом.

Решения и их причины: `docs/infra/00-main-spec.md`.

**Это стенд, не прод.** `NODE_ENV=development` (так требует `KEY_SOURCE=env` — ключи Nile в
окружении), поэтому Swagger открыт на `https://<api>/api`. `DB_SYNCHRONIZE=true`: схему создаёт и
меняет TypeORM при старте; при сужении колонок данные могут теряться.

## Что нужно заранее

1. VPS с Ubuntu 26.04 и доступ `root` по SSH-ключу.
2. Два DNS-записи `A` на IP сервера: для API и для фронта.
3. Два **read-only deploy key** в GitHub: один для `devpaybull/back`, другой для репозитория фронта
   (GitHub не даёт повесить один ключ на два репозитория).
4. Локально: `ansible-core` ≥ 2.16 и коллекции:

   ```sh
   cd infra/ansible
   ansible-galaxy collection install -r requirements.yml -p collections
   ```

## Настройка

1. `inventory/test/hosts.yml` — `ansible_host`: IP сервера.
2. `inventory/test/group_vars/all/main.yml`:
   - `paybull_deploy_authorized_keys` — публичные SSH-ключи тех, кто будет заходить как `deploy`;
   - `paybull_api_domain`, `paybull_front_domain`, `paybull_acme_email`;
   - фронт: `paybull_front_repo` (SSH-адрес), `paybull_front_version` (ветка), `paybull_front_build_command`
     (например `npm ci && npm run build`), `paybull_front_dist_dir` (папка результата),
     `paybull_front_api_url_variable` (имя переменной, в которую при сборке попадёт
     `https://<api-домен>`); `paybull_front_node_image` — образ Node для сборки;
   - `paybull_backend_env` — обязательные бизнес-настройки и контракт USDT на Nile; деплой не начнётся,
     пока хоть одна пустая. Смысл каждой — в `.env.example`.
3. Секреты:

   ```sh
   cp inventory/test/group_vars/all/vault.yml.example inventory/test/group_vars/all/vault.yml
   # заполнить
   ansible-vault encrypt inventory/test/group_vars/all/vault.yml
   ```

   **Не коммитьте `vault.yml` незашифрованным.** Проверка: файл начинается с `$ANSIBLE_VAULT;`.
   Ключи Tron — только тестовые (Nile). `vault_seed_totp_secret` — base32 (`A-Z`, `2-7`), от 16 символов.

## Запуск

```sh
cd infra/ansible

# 1. один раз, под root: пользователь deploy, SSH только по ключу, ufw 22/80/443, fail2ban,
#    автообновления безопасности, Docker
ansible-playbook playbooks/bootstrap.yml -u root --ask-vault-pass

# 2. деплой (и каждый следующий): git → сборка фронта → .env → compose up → проверка HTTPS
ansible-playbook playbooks/deploy.yml -u deploy --ask-vault-pass

# 3. один раз: тестовые данные; повторный запуск ничего не меняет
ansible-playbook playbooks/seed.yml -u deploy --ask-vault-pass
```

После `bootstrap` вход под `root` и по паролю закрыт — проверьте, что заходите как `deploy`, до
закрытия текущей сессии. Другая ветка бэкенда: `-e paybull_backend_version=<ветка>`.

Логины seed-пользователей и их резервные коды сохраняются на сервере в
`/opt/paybull/seed-output.txt` (`0600`), в вывод Ansible не попадают. Пароль и секрет TOTP — из
`vault.yml`.

## Обслуживание

```sh
ssh deploy@<ip>
cd /opt/paybull
docker compose ps
docker compose logs -f backend
```

VictoriaLogs: `ssh -L 9428:127.0.0.1:9428 deploy@<ip>`, затем `http://localhost:9428/select/vmui`.

Начать базу с нуля: `docker compose down`, `docker volume rm paybull_postgres-data`, снова `deploy`
и `seed`.

## Чего здесь нет

Бэкапов базы, мониторинга, CI/CD и миграций. Docker публикует порты в обход ufw — поэтому наружу
опубликованы только `80`/`443` Caddy, а VictoriaLogs привязан к `127.0.0.1`.
