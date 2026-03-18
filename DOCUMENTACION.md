# PekePBX-BC: Integración Centralita - Business Central

## Descripción General

PekePBX-BC es un sistema que conecta la centralita telefónica PekePBX (basada en Asterisk) con Microsoft Dynamics 365 Business Central. Su objetivo es que cuando un operador recibe una llamada, se abra automáticamente la ficha del contacto en Business Central (screen pop), y que al finalizar la llamada se registre automáticamente en el CRM.

---

## Arquitectura

```
┌──────────────┐        AMI (TCP)         ┌──────────────────┐
│              │◄────────────────────────► │                  │
│   PekePBX    │    Puerto 5100           │   PekePBX-BC     │
│  (Asterisk)  │    Eventos en            │   (Node.js)      │
│              │    tiempo real            │                  │
└──────────────┘                          │  ┌────────────┐  │
                                          │  │ AMI Service │  │
                                          │  └──────┬─────┘  │
                                          │         │        │
                                          │  ┌──────▼─────┐  │        OAuth 2.0 + SOAP
                                          │  │  BC Hooks   │──────────────────────┐
                                          │  └──────┬─────┘  │                    │
                                          │         │        │                    ▼
                                          │  ┌──────▼─────┐  │         ┌──────────────────┐
                                          │  │ SSE Manager │  │         │   Business       │
                                          │  └──────┬─────┘  │         │   Central        │
                                          └─────────┼────────┘         │   (Cloud)        │
                                                    │ SSE                └──────────────────┘
                                                    ▼
                                          ┌──────────────────┐
                                          │  Navegador del   │
                                          │  Operador        │
                                          │  (Panel Web)     │
                                          └──────────────────┘
```

---

## Conexión con la Centralita (PekePBX / Asterisk)

### Protocolo: AMI (Asterisk Manager Interface)

La aplicación se conecta a la centralita mediante **AMI**, un protocolo TCP nativo de Asterisk que permite recibir eventos de llamadas en tiempo real.

- **Conexión**: Socket TCP directo al servidor Asterisk (puerto 5100)
- **Autenticación**: Usuario y contraseña AMI configurados en el .env
- **Reconexión automática**: Si se pierde la conexión, reintenta cada 5 segundos

### Eventos que escucha

| Evento AMI | Cuándo ocurre | Qué hace la aplicación |
|------------|---------------|----------------------|
| **DialBegin** | La llamada empieza a sonar en el teléfono del operador | Extrae el número del llamante y la extensión destino. Lanza una búsqueda anticipada en Business Central mientras el teléfono sigue sonando |
| **DialEnd** | El operador contesta (o no) la llamada | Si contestó (ANSWER), envía una notificación al navegador del operador con el resultado de la búsqueda en BC |
| **Hangup** | La llamada finaliza (cuelgan) | Si la llamada fue contestada, registra la llamada en Business Central via SOAP |

### Identificación del operador

Cada extensión de la centralita tiene un SIP peer con formato `ext{tenantId}{extensión}`. Por ejemplo:
- `ext2014101` = Tenant 20141, extensión 01
- `ext2014115` = Tenant 20141, extensión 15

La aplicación usa este patrón para:
1. Saber a qué tenant de Business Central pertenece la llamada
2. Enviar la notificación al operador correcto

---

## Conexión con Business Central

### Autenticación: OAuth 2.0 (Client Credentials)

La aplicación se autentica contra Azure AD usando credenciales de aplicación (no de usuario):

```
POST https://login.microsoftonline.com/{azure_tenant_id}/oauth2/v2.0/token

  client_id      = ID de la aplicación registrada en Azure
  client_secret  = Clave secreta de la aplicación
  scope          = https://api.businesscentral.dynamics.com/.default
  grant_type     = client_credentials
```

El token obtenido se cachea en memoria y se renueva automáticamente antes de que expire.

### Servicio Web: SOAP (WSRegistroLlamadas)

Business Central expone un Codeunit personalizado llamado **WSRegistroLlamadas** con dos métodos:

#### 1. ObtenerURL (Búsqueda de contacto)

Se invoca **mientras el teléfono suena** (antes de que el operador conteste).

- **Entrada**: Número de teléfono del llamante
- **Salida**: URL de la ficha del contacto en BC, o vacío si no existe
- **Uso**: Si devuelve URL, se abrirá automáticamente la ficha al contestar. Si no, se ofrece crear un nuevo contacto

```xml
<ObtenerURL>
  <codTelefono>912345678</codTelefono>
</ObtenerURL>

<!-- Respuesta -->
<return_value>https://businesscentral.dynamics.com/.../page/5050?...</return_value>
```

#### 2. RegistrarLlamada (Registro de llamada)

Se invoca **al colgar**, solo si la llamada fue contestada.

- **Entrada**: Extensión del operador + número de teléfono
- **Salida**: true/false (registrada correctamente o no)
- **Uso**: Queda registrada la llamada en el historial del contacto en BC

```xml
<RegistrarLlamada>
  <xMLRegistroLlamadas>
    <Registro>
      <Extension>01</Extension>
      <Telefono>912345678</Telefono>
    </Registro>
  </xMLRegistroLlamadas>
</RegistrarLlamada>

<!-- Respuesta -->
<return_value>true</return_value>
```

### URL del servicio web

```
https://api.businesscentral.dynamics.com/v2.0/{azure_tenant_id}/{environment}/WS/{company}/Codeunit/WSRegistroLlamadas
```

---

## Flujo Completo de una Llamada

```
  LLAMADA ENTRANTE                    PekePBX-BC                     Business Central
  ═══════════════                    ══════════                     ════════════════

  1. Suena el teléfono
     del operador
         │
         ├── DialBegin ──────────►  Recibe evento AMI
                                    Extrae: número llamante,
                                    extensión destino, tenant
                                         │
                                         ├──── ObtenerURL(teléfono) ────► Busca contacto
                                         │                                 por teléfono
                                         │◄─── URL ficha (o vacío) ◄────  Devuelve resultado
                                         │
                                    Guarda resultado en memoria
                                    (esperando a que contesten)

  2. Operador contesta
         │
         ├── DialEnd (ANSWER) ──► Envía notificación SSE
                                   al navegador del operador
                                         │
                                         ▼
                                  ┌─────────────────────┐
                                  │ SCREEN POP           │
                                  │                     │
                                  │ Si encontrado:      │
                                  │  → Abre ficha BC    │
                                  │    automáticamente  │
                                  │                     │
                                  │ Si NO encontrado:   │
                                  │  → Abre BC para     │
                                  │    crear contacto   │
                                  └─────────────────────┘

  3. Cuelgan
         │
         ├── Hangup ─────────────► Detecta que fue contestada
                                         │
                                         ├── RegistrarLlamada ──────► Registra la llamada
                                         │   (extensión, teléfono)    en el historial
                                         │                            del contacto
                                         │◄─── true ◄──────────────  Confirmación
                                         │
                                    Guarda en log local (SQLite)
```

---

## Comunicación con el Navegador del Operador

### Protocolo: Server-Sent Events (SSE)

La aplicación usa SSE para enviar notificaciones en tiempo real al navegador del operador, sin que este tenga que hacer polling.

- El operador abre el panel web y se conecta al servidor via SSE
- El servidor identifica al operador por su extensión/SIP peer
- Cuando llega una llamada contestada, envía un evento `bc_screen_pop` **solo al operador que contestó**
- El navegador recibe el evento y abre Business Central automáticamente

### Datos del Screen Pop

```json
{
  "phone": "912345678",
  "bcUrl": "https://businesscentral.dynamics.com/...",
  "found": false,
  "newContactUrl": "https://businesscentral.dynamics.com/...&page=5052&phoneno=912345678"
}
```

- `found: true` → Se abre la ficha del contacto existente
- `found: false` → Se abre la página de creación de contacto con el teléfono pre-rellenado

---

## Configuración Necesaria

### Datos de Business Central (por tenant)

| Campo | Descripción | Ejemplo |
|-------|-------------|---------|
| Client ID | ID de la aplicación en Azure AD | `b75e6ab5-b637-47df-...` |
| Client Secret | Clave secreta de la aplicación | `Nu~8Q~ed9kiaB...` |
| Azure Tenant ID | ID del tenant de Azure | `ee91818c-c2e2-...` |
| Environment | Entorno de BC | `Production` |
| Company | Empresa en BC | `VITOGAS_2017` |

### Datos de la Centralita

| Campo | Descripción | Ejemplo |
|-------|-------------|---------|
| AMI Host | IP del servidor Asterisk | `62.210.62.5` |
| AMI Port | Puerto AMI | `5100` |
| AMI User | Usuario AMI | `webrtcc` |
| AMI Password | Contraseña AMI | *(configurado en .env)* |

---

## Requisitos en Business Central

1. **Aplicación registrada en Azure AD** con permisos para acceder a la API de Business Central
2. **Codeunit WSRegistroLlamadas** publicado como servicio web con los métodos:
   - `ObtenerURL(codTelefono)` → Devuelve URL de ficha del contacto
   - `RegistrarLlamada(Extension, Telefono)` → Registra la llamada en BC
3. **Contactos con teléfonos cargados** para que la búsqueda ObtenerURL devuelva resultados

---

## Panel de Administración

La aplicación incluye un panel web con:

- **Dashboard**: Logs del servidor en tiempo real + historial de llamadas recientes
- **Configuración BC**: Gestión de credenciales por tenant, test de conexión y búsqueda
- **Usuarios**: Alta/baja de operadores con asignación de extensión y tenant
- **Panel Operador**: Vista simplificada para los operadores con screen pop integrado
