import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '../services/api.js'
import sseClient from '../services/sse.js'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(JSON.parse(localStorage.getItem('user') || 'null'))
  const token = ref(localStorage.getItem('token') || '')
  const sseConnected = ref(false)

  const isAdmin = computed(() => user.value?.role === 'admin')

  async function login(username, password) {
    const { data } = await api.post('/auth/login', { username, password })
    token.value = data.token
    user.value = data.user
    localStorage.setItem('token', data.token)
    localStorage.setItem('user', JSON.stringify(data.user))
    connectSSE()
  }

  async function logout() {
    try { await api.post('/auth/logout') } catch {}
    sseClient.disconnect()
    token.value = ''
    user.value = null
    sseConnected.value = false
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }

  async function fetchMe() {
    try {
      const { data } = await api.get('/auth/me')
      user.value = data.user
      localStorage.setItem('user', JSON.stringify(data.user))
    } catch {
      await logout()
    }
  }

  function connectSSE() {
    if (!token.value) return
    sseClient.connect(token.value)
    sseClient.on('connected', () => { sseConnected.value = true })
  }

  // Auto-connect SSE on load if we have a token
  if (token.value) {
    connectSSE()
  }

  async function updateExtension(tenantId, extension) {
    const { data } = await api.put('/auth/me/extension', { tenant_id: tenantId, extension })
    user.value = data.user
    localStorage.setItem('user', JSON.stringify(data.user))
    // Reconnect SSE so the server picks up the new sipPeer
    sseClient.disconnect()
    sseConnected.value = false
    connectSSE()
  }

  return { user, token, isAdmin, sseConnected, login, logout, fetchMe, connectSSE, updateExtension }
})
