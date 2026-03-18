<template>
  <div class="min-h-screen bg-gray-50 flex flex-col items-center py-10 px-5 relative">
    <!-- Logout button -->
    <button @click="handleLogout"
            class="absolute top-4 right-4 px-3 py-1.5 border border-gray-300 text-gray-500 rounded-lg hover:bg-gray-100 hover:text-gray-700 transition text-xs font-medium">
      <i class="fas fa-sign-out-alt mr-1"></i>Salir
    </button>

    <!-- Setup card -->
    <div class="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-md overflow-hidden">
      <!-- Header -->
      <div class="px-5 py-4 border-b border-gray-100 text-center">
        <div class="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mx-auto mb-2">
          <i class="fab fa-microsoft text-white text-xl"></i>
        </div>
        <h1 class="text-lg font-bold text-gray-900">PekePBX-BC</h1>
        <p class="text-xs text-gray-500 mt-0.5">{{ auth.user?.full_name }}</p>
      </div>

      <!-- Status bar -->
      <div v-if="connected" class="px-5 py-2.5 bg-green-50 border-b border-green-100 flex items-center gap-2">
        <span class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
        <span class="text-xs text-green-700 font-medium">Conectado — Extension {{ activeExtension }}</span>
      </div>
      <div v-else-if="auth.sseConnected" class="px-5 py-2.5 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
        <span class="w-2 h-2 bg-blue-500 rounded-full"></span>
        <span class="text-xs text-blue-700 font-medium">SSE conectado</span>
      </div>

      <!-- Body -->
      <div class="p-5 space-y-4">
        <div v-if="error" class="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          <i class="fas fa-exclamation-circle mr-1"></i>{{ error }}
        </div>

        <!-- Empresa -->
        <div>
          <label class="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Empresa</label>
          <select v-model="selectedTenant" :disabled="connected || loading"
                  class="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white disabled:bg-gray-100 disabled:cursor-not-allowed appearance-none">
            <option value="">Selecciona empresa...</option>
            <option v-for="t in tenants" :key="t.id" :value="t.id">{{ t.company }}</option>
          </select>
        </div>

        <!-- Extension -->
        <div>
          <label class="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Mi Extension</label>
          <input v-model="extension" type="text" inputmode="numeric" pattern="[0-9]*"
                 :disabled="connected || loading"
                 class="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                 placeholder="Ej: 10">
        </div>

        <!-- Conectar / Desconectar -->
        <button v-if="!connected" @click="handleConnect" :disabled="loading || !selectedTenant || !extension"
                class="w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed">
          <i v-if="loading" class="fas fa-spinner fa-spin mr-1"></i>
          {{ loading ? 'Conectando...' : 'Conectar' }}
        </button>
        <button v-else @click="handleDisconnect"
                class="w-full py-2.5 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition font-medium text-sm">
          <i class="fas fa-plug mr-1"></i>Cambiar
        </button>
      </div>
    </div>

    <!-- Activity card -->
    <div v-if="connected" class="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-md overflow-hidden mt-4">
      <div class="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <span class="text-sm font-semibold text-gray-700">Actividad</span>
        <span class="text-[10px] text-gray-400">{{ events.length }} eventos</span>
      </div>
      <div class="max-h-64 overflow-y-auto">
        <div v-if="events.length === 0" class="px-5 py-6 text-center text-xs text-gray-400">
          Esperando llamadas...
        </div>
        <div v-for="(evt, i) in events" :key="i"
             class="px-5 py-2.5 border-b border-gray-50 last:border-0 flex items-start gap-3">
          <span class="text-[10px] text-gray-400 font-mono mt-0.5 shrink-0">{{ evt.time }}</span>
          <span class="text-xs text-gray-700">{{ evt.message }}</span>
          <a v-if="evt.url" :href="evt.url" target="_blank"
             class="ml-auto text-xs text-blue-600 hover:underline shrink-0">Abrir</a>
        </div>
      </div>
    </div>

    <!-- Screen Pop -->
    <ScreenPop />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'
import ScreenPop from '../components/ScreenPop.vue'
import sseClient from '../services/sse.js'
import api from '../services/api.js'

const router = useRouter()
const auth = useAuthStore()

const tenants = ref([])
const selectedTenant = ref('')
const extension = ref('')
const connected = ref(false)
const loading = ref(false)
const error = ref('')
const activeExtension = ref('')
const events = ref([])

let unsubScreenPop = null

function timeNow() {
  return new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function addEvent(message, url) {
  events.value.unshift({ time: timeNow(), message, url: url || null })
  if (events.value.length > 50) events.value.length = 50
}

onMounted(async () => {
  // Load tenants
  try {
    const { data } = await api.get('/auth/tenants')
    tenants.value = data.tenants || []
  } catch (err) {
    console.error('Error loading tenants:', err)
  }

  // If user already has extension configured, pre-fill and auto-connect
  const user = auth.user
  if (user?.extension && user?.tenant_id) {
    extension.value = user.extension
    selectedTenant.value = String(user.tenant_id)
    connected.value = true
    activeExtension.value = user.extension
    addEvent('Conectado al servidor')
  }

  // Listen for screen pops to add to activity
  unsubScreenPop = sseClient.on('bc_screen_pop', (data) => {
    const msg = data.found
      ? `Contacto encontrado: ${data.phone}`
      : `Llamada entrante: ${data.phone}`
    addEvent(msg, data.bcUrl)
  })
})

onUnmounted(() => {
  if (unsubScreenPop) unsubScreenPop()
})

async function handleConnect() {
  error.value = ''
  loading.value = true
  try {
    await auth.updateExtension(selectedTenant.value, extension.value)
    connected.value = true
    activeExtension.value = extension.value
    events.value = []
    addEvent('Conectado al servidor')
  } catch (err) {
    error.value = err.response?.data?.error || 'Error al conectar'
  } finally {
    loading.value = false
  }
}

function handleDisconnect() {
  sseClient.disconnect()
  auth.sseConnected = false
  connected.value = false
  activeExtension.value = ''
  events.value = []
}

async function handleLogout() {
  await auth.logout()
  router.push('/login')
}
</script>
