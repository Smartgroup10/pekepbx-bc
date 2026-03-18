/**
 * SSE Client - EventSource wrapper with auto-reconnect
 */
export class SseClient {
  constructor() {
    this.eventSource = null
    this.handlers = new Map()
    this.reconnectTimer = null
    this.connected = false
  }

  connect(token) {
    this.disconnect()

    const url = `/api/events?token=${encodeURIComponent(token)}`
    this.eventSource = new EventSource(url)

    this.eventSource.addEventListener('connected', (e) => {
      this.connected = true
      console.log('SSE: Connected', JSON.parse(e.data))
      this._emit('connected', JSON.parse(e.data))
    })

    this.eventSource.addEventListener('bc_screen_pop', (e) => {
      const data = JSON.parse(e.data)
      this._emit('bc_screen_pop', data)
    })

    this.eventSource.addEventListener('server_log', (e) => {
      const data = JSON.parse(e.data)
      this._emit('server_log', data)
    })

    this.eventSource.addEventListener('extensions_update', (e) => {
      const data = JSON.parse(e.data)
      this._emit('extensions_update', data)
    })

    this.eventSource.onerror = () => {
      this.connected = false
      console.log('SSE: Connection error, reconnecting in 5s...')
      this.eventSource?.close()
      this.eventSource = null
      this._scheduleReconnect(token)
    }
  }

  on(event, handler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set())
    }
    this.handlers.get(event).add(handler)
    return () => this.handlers.get(event)?.delete(handler)
  }

  _emit(event, data) {
    const handlers = this.handlers.get(event)
    if (handlers) {
      for (const handler of handlers) {
        handler(data)
      }
    }
  }

  _scheduleReconnect(token) {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect(token)
    }, 5000)
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
    this.connected = false
  }
}

export default new SseClient()
