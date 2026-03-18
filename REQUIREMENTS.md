# Requisitos — PekePBX Business Central

## Requisitos del sistema

| Componente | Versión mínima | Notas |
|------------|---------------|-------|
| Node.js | 18.x | Requerido para `fetch` nativo y `--watch` |
| npm | 9.x | Incluido con Node.js 18+ |
| Git | 2.x | Para despliegue |

## Requisitos de infraestructura

### Servidor PekePBX (Asterisk)
- Acceso AMI (Asterisk Manager Interface) habilitado
- Usuario AMI con permisos de lectura de eventos (`call`, `agent`)
- Puerto AMI accesible desde el servidor de la aplicación (por defecto TCP 5100)

### Microsoft Business Central
- Tenant de BC con web services SOAP habilitados
- App registrada en Azure AD (Entra ID) con:
  - **Client ID** y **Client Secret**
  - Permisos de API: `Dynamics 365 Business Central > API.ReadWrite.All`
- Web services publicados:
  - Página de proveedores (Vendor List) con campo de teléfono
  - Página de contactos (Contact List) — opcional

### Red
- El servidor debe tener acceso a:
  - `AMI_HOST:AMI_PORT` (Asterisk AMI)
  - `login.microsoftonline.com` (OAuth2 token)
  - `api.businesscentral.dynamics.com` (BC API/SOAP)
- Puerto `4500` (o el configurado) accesible para los usuarios

## Dependencias del backend

| Paquete | Versión | Función |
|---------|---------|---------|
| express | ^4.21 | Servidor HTTP + API REST |
| better-sqlite3 | ^11.7 | Base de datos SQLite (WAL mode) |
| jsonwebtoken | ^9.0 | Autenticación JWT |
| bcryptjs | ^2.4 | Hash de contraseñas |
| helmet | ^8.1 | Headers de seguridad HTTP |
| express-rate-limit | ^8.3 | Protección contra abuso |
| cors | ^2.8 | Cross-Origin Resource Sharing |
| dotenv | ^16.4 | Variables de entorno desde .env |

## Dependencias del frontend

| Paquete | Versión | Función |
|---------|---------|---------|
| vue | ^3.5 | Framework UI |
| vue-router | ^4.5 | Routing SPA |
| pinia | ^2.3 | State management |
| axios | ^1.7 | Cliente HTTP |

### Dev dependencies (frontend)

| Paquete | Versión | Función |
|---------|---------|---------|
| vite | ^6.0 | Build tool + dev server |
| @vitejs/plugin-vue | ^5.2 | Plugin Vue para Vite |
| tailwindcss | ^3.4 | Framework CSS utility-first |
| postcss | ^8.4 | Procesador CSS |
| autoprefixer | ^10.4 | Vendor prefixes automáticos |

## Puertos utilizados

| Puerto | Servicio | Dirección |
|--------|----------|-----------|
| 4500 | HTTP (Express) | Inbound — navegadores de operadores y admins |
| 5100 | AMI (Asterisk) | Outbound — conexión al PBX |
| 443 | HTTPS | Outbound — OAuth2 + Business Central API |

## Navegadores soportados

- Chrome / Edge 90+
- Firefox 90+
- Safari 15+

Requiere soporte de `EventSource` (SSE) y ES2020+.

## Requisitos de producción

### Recomendados
- **Process manager**: PM2 o systemd para auto-restart
- **Reverse proxy**: Nginx delante de Express (SSL termination, static files)
- **Backup**: Copias periódicas de `pekepbx-bc.db`
- **JWT_SECRET**: Mínimo 32 caracteres aleatorios (ver `.env.example`)
- **ENCRYPTION_KEY**: Separado del JWT_SECRET para encriptar secretos en BD

### Ejemplo PM2
```bash
pm2 start server/index.js --name pekepbx-bc
pm2 save
pm2 startup
```

### Ejemplo Nginx
```nginx
server {
    listen 443 ssl;
    server_name pekepbx-bc.ejemplo.com;

    ssl_certificate     /etc/ssl/certs/cert.pem;
    ssl_certificate_key /etc/ssl/private/key.pem;

    location / {
        proxy_pass http://127.0.0.1:4500;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE: desactivar buffering
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
}
```
