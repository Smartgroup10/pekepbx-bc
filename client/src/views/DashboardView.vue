<template>
  <div class="p-6">
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-gray-900">
        <i class="fas fa-desktop mr-2 text-blue-600"></i>Dashboard
      </h1>
      <p class="text-sm text-gray-600 mt-1">Monitor de llamadas y logs del servidor</p>
    </div>

    <!-- Status card -->
    <div class="grid grid-cols-1 md:grid-cols-1 gap-4 mb-6">
      <div class="bg-white rounded-lg shadow p-4">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg flex items-center justify-center" :class="auth.sseConnected ? 'bg-green-100' : 'bg-red-100'">
            <i class="fas fa-satellite-dish" :class="auth.sseConnected ? 'text-green-600' : 'text-red-600'"></i>
          </div>
          <div>
            <p class="text-xs text-gray-500">SSE</p>
            <p class="text-sm font-semibold" :class="auth.sseConnected ? 'text-green-700' : 'text-red-700'">
              {{ auth.sseConnected ? 'Conectado' : 'Desconectado' }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Server Logs (real-time) -->
    <div class="bg-gray-900 rounded-lg shadow mb-6 overflow-hidden">
      <div class="px-5 py-3 border-b border-gray-700 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-gray-200">
          <i class="fas fa-terminal mr-1 text-green-400"></i>Server Logs
        </h2>
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-gray-500">{{ logs.length }} lineas</span>
          <button @click="logs = []" class="text-xs text-gray-400 hover:text-white transition">
            <i class="fas fa-trash-alt mr-1"></i>Limpiar
          </button>
        </div>
      </div>
      <div ref="logContainer" class="p-4 h-64 overflow-y-auto font-mono text-xs leading-5 space-y-0.5">
        <div v-if="logs.length === 0" class="text-gray-600 text-center py-8">
          Esperando logs del servidor...
        </div>
        <div v-for="(log, i) in logs" :key="i"
          :class="log.level === 'error' ? 'text-red-400' : log.message.includes('BC') || log.message.includes('Screen pop') ? 'text-cyan-400' : log.message.includes('AMI') ? 'text-yellow-400' : log.message.includes('SSE') ? 'text-green-400' : 'text-gray-300'">
          <span class="text-gray-600">{{ formatLogTime(log.time) }}</span>
          {{ log.message }}
        </div>
      </div>
    </div>

    <!-- Connected extensions -->
    <div class="bg-white rounded-lg shadow">
      <div class="px-5 py-3 border-b flex items-center justify-between">
        <h2 class="text-sm font-semibold text-gray-900">
          <i class="fas fa-plug mr-1 text-green-500"></i>Extensiones conectadas
          <span v-if="extensions.length" class="ml-2 bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full">
            {{ extensions.length }}
          </span>
        </h2>
      </div>

      <div v-if="loadingExtensions" class="p-8 text-center text-gray-400 text-sm">
        <i class="fas fa-spinner fa-spin text-xl mb-2"></i>
      </div>

      <div v-else-if="extensions.length === 0" class="p-8 text-center text-gray-400 text-sm">
        <i class="fas fa-plug text-2xl mb-2"></i>
        <p>Sin extensiones conectadas</p>
      </div>

      <div v-else class="divide-y">
        <div v-for="ext in extensions" :key="ext.userId" class="px-5 py-3 flex items-center justify-between hover:bg-gray-50">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
              <i class="fas fa-circle text-green-500 text-[8px]"></i>
            </div>
            <div>
              <p class="text-sm font-medium text-gray-900">Ext {{ ext.extension }}</p>
              <p class="text-xs text-gray-500">{{ ext.sipPeer }} - Tenant {{ ext.tenantId }}</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="ext.role === 'admin'" class="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-medium">Admin</span>
            <span v-if="ext.connections > 1" class="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-mono">{{ ext.connections }}x</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '../stores/auth.js'
import api from '../services/api.js'
import sseClient from '../services/sse.js'

const auth = useAuthStore()
const logs = ref([])
const logContainer = ref(null)
const MAX_LOGS = 200

const extensions = ref([])
const loadingExtensions = ref(true)

let unsubLog = null
let unsubExtensions = null

function handleLog(data) {
  logs.value.push(data)
  if (logs.value.length > MAX_LOGS) {
    logs.value = logs.value.slice(-MAX_LOGS)
  }
  nextTick(() => {
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  })
}

function formatLogTime(t) {
  if (!t) return ''
  const d = new Date(t)
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

async function loadExtensions() {
  try {
    const { data } = await api.get('/events/extensions')
    extensions.value = data
  } catch (err) {
    // silent
  } finally {
    loadingExtensions.value = false
  }
}

onMounted(() => {
  loadExtensions()
  unsubLog = sseClient.on('server_log', handleLog)
  unsubExtensions = sseClient.on('extensions_update', (data) => {
    extensions.value = data
  })
})

onUnmounted(() => {
  if (unsubLog) unsubLog()
  if (unsubExtensions) unsubExtensions()
})
</script>
