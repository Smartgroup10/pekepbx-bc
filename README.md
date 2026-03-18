# PekePBX - Business Central

Integración multitenant entre PekePBX (Asterisk/Kamailio) y Microsoft Dynamics 365 Business Central. Proporciona screen pop automático en llamadas entrantes, registro de llamadas en BC y panel de operador en tiempo real.

## Arquitectura

```
┌─────────────┐    AMI     ┌──────────────┐    SSE     ┌──────────────┐
│  PekePBX    │◄──────────►│  Backend     │◄──────────►│  Frontend    │
│  (Asterisk) │   TCP:5100 │  (Express)   │  /api/     │  (Vue 3)     │
└─────────────┘            │              │            │              │
                           │  SQLite DB   │            │  Panel Admin │
┌─────────────┐   SOAP/   │  (better-    │            │  Panel Op.   │
│  Business   │◄──────────►│   sqlite3)   │            └──────────────┘
│  Central    │  OAuth2    └──────────────┘
└─────────────┘
```

## Stack

### Backend
- **Express** — API REST + SSE
- **better-sqlite3** — Base de datos local (WAL mode)
- **jsonwebtoken** — Autenticación JWT
- **helmet** — Headers de seguridad
- **express-rate-limit** — Protección contra abuso
- **bcryptjs** — Hash de contraseñas

### Frontend
- **Vue 3** — Composition API + `<script setup>`
- **Pinia** — State management
- **Vue Router** — SPA routing
- **TailwindCSS** — Estilos
- **Axios** — HTTP client
- **Vite** — Build tool

## Funcionalidades

- **Screen Pop**: Al recibir una llamada, busca el contacto en BC por número de teléfono y abre automáticamente la ficha del proveedor/cliente en el navegador del operador
- **Registro de llamadas**: Las llamadas contestadas se registran automáticamente en Business Central
- **Panel de operador**: Vista sin autenticación accesible via URL con tenant + extensión (`/operador`)
- **Panel de administración**: Dashboard con logs del servidor en tiempo real, extensiones conectadas (SSE) y gestión de usuarios/configuración
- **Multi-tenant**: Soporte para múltiples empresas de BC, cada una con su propia configuración OAuth2 y mapeo de extensiones
- **SSE en tiempo real**: Eventos push para screen pop, logs del servidor y estado de extensiones conectadas

## Instalación

### Requisitos previos

- Node.js >= 18
- Acceso AMI al servidor PekePBX (Asterisk)
- Tenant configurado en Business Central con OAuth2

### Setup

```bash
# Clonar repositorio
git clone https://github.com/Smartgroup10/pekepbx-bc.git
cd pekepbx-bc

# Instalar dependencias del backend
npm install

# Instalar dependencias del frontend
cd client && npm install

# Build del frontend
npm run build
cd ..

# Configurar variables de entorno
cp .env.example .env
# Editar .env con los valores reales (ver sección Configuración)

# Iniciar servidor
npm start
```

El servidor arranca en `http://localhost:4500` (o el puerto configurado en `.env`).

## Configuración

### Variables de entorno (`.env`)

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `PORT` | Puerto del servidor | `4500` |
| `NODE_ENV` | Entorno | `production` |
| `JWT_SECRET` | Secreto para tokens JWT (mín. 32 chars) | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `ENCRYPTION_KEY` | Clave para encriptar secretos en BD (opcional) | Igual que JWT_SECRET |
| `ALLOWED_ORIGINS` | Orígenes CORS permitidos (solo en production) | `https://mi-dominio.com` |
| `AMI_HOST` | IP del servidor Asterisk | `62.210.59.81` |
| `AMI_PORT` | Puerto AMI | `5100` |
| `AMI_USER` | Usuario AMI | `webrtcc` |
| `AMI_PASSWORD` | Contraseña AMI | `****` |

### Configuración de Business Central

La configuración de cada tenant se gestiona desde el panel de administración (`/settings`):

- **Tenant ID**: ID del tenant PekePBX (ej: `20242`)
- **BC Environment / Company**: Entorno y empresa de BC
- **OAuth2 Client ID / Secret**: Credenciales de la app registrada en Azure AD
- **Mapeo de extensiones**: Qué extensiones del tenant se integran con BC

## Uso

### Panel de administración

Acceder a `http://localhost:4500` con las credenciales de admin.

- **Dashboard**: Logs del servidor en tiempo real + extensiones conectadas via SSE
- **Settings**: Configuración de integración BC por tenant
- **Users**: Gestión de usuarios (admin/user)

### Panel de operador

Acceder a `http://localhost:4500/operador`, seleccionar tenant y extensión.

No requiere autenticación. Al recibir una llamada, se abrirá automáticamente la ficha del contacto en Business Central.

## Scripts

```bash
# Producción
npm start

# Desarrollo (hot reload del backend)
npm run dev

# Build frontend
cd client && npm run build

# Dev frontend (hot reload)
cd client && npm run dev
```

## Estructura del proyecto

```
pekepbx-bc/
├── server/
│   ├── index.js              # Entry point + Express setup
│   ├── db.js                 # SQLite schema + prepared statements
│   ├── constants.js          # Timeouts, intervals, limits
│   ├── middleware/
│   │   └── auth.js           # JWT auth + adminOnly middleware
│   ├── routes/
│   │   ├── auth.js           # Login/logout/me
│   │   ├── bc.js             # BC config + call log
│   │   ├── events.js         # SSE endpoints (admin + operator)
│   │   └── users.js          # User CRUD (admin)
│   ├── services/
│   │   ├── ami.js            # Asterisk AMI TCP client
│   │   ├── bc.js             # Business Central SOAP/OAuth2
│   │   ├── bcHooks.js        # AMI event → BC lookup/register
│   │   └── sse.js            # SSE connection manager
│   └── utils/
│       ├── crypto.js         # AES encryption for DB secrets
│       └── validate.js       # Input validation helpers
├── client/
│   ├── src/
│   │   ├── views/            # Vue pages (Dashboard, Login, Settings, Users, UserPanel)
│   │   ├── components/       # AppLayout, ScreenPop
│   │   ├── stores/           # Pinia (auth)
│   │   ├── services/         # API client, SSE client
│   │   └── router.js         # Vue Router
│   ├── operador.html         # Standalone operator panel (no Vue)
│   └── vite.config.js        # Vite config with API proxy
├── .env.example
├── package.json
└── README.md
```

## Seguridad

- Contraseñas hasheadas con bcrypt
- JWT con expiración de 24h
- Secretos de BC encriptados en BD (AES-256-GCM)
- Rate limiting global (100 req/min) y estricto en login (5 intentos/15min)
- Headers de seguridad via Helmet
- CORS restrictivo en producción
- Validación de inputs en endpoints públicos

## Licencia

Uso interno — SmartGroup / Smartgroup10
