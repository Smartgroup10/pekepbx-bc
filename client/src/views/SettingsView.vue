<template>
  <div class="p-6">
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-gray-900">
        <i class="fab fa-microsoft mr-2 text-blue-600"></i>Business Central
      </h1>
      <p class="text-sm text-gray-600 mt-1">Configuracion de tenants BC por PBX</p>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-12 text-gray-500">
      <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
      <p class="text-sm">Cargando configuraciones...</p>
    </div>

    <template v-else>
      <!-- Add tenant button -->
      <div class="flex items-center justify-between mb-4">
        <span class="text-sm text-gray-500">{{ configs.length }} tenant(s) configurado(s)</span>
        <button @click="showAdd = true" v-if="!showAdd"
          class="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-xs font-medium">
          <i class="fas fa-plus mr-1"></i>Agregar Tenant
        </button>
      </div>

      <!-- Add form -->
      <div v-if="showAdd" class="bg-white rounded-lg shadow p-4 mb-4 max-w-3xl">
        <div class="flex items-center gap-3">
          <input v-model="newTid" type="text" placeholder="Tenant ID PBX (ej: 20141)" @keyup.enter="addTenant"
            class="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm">
          <button @click="addTenant" :disabled="!newTid.trim()"
            class="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 text-xs font-medium">Agregar</button>
          <button @click="showAdd = false; newTid = ''"
            class="px-3 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition text-xs font-medium">Cancelar</button>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="configs.length === 0 && !showAdd" class="bg-white rounded-lg shadow p-8 max-w-3xl text-center">
        <i class="fab fa-microsoft text-3xl text-gray-300 mb-2"></i>
        <p class="text-sm text-gray-500">Sin configuraciones Business Central</p>
      </div>

      <!-- Tenant cards -->
      <div class="space-y-4">
        <div v-for="t in configs" :key="t.tenant_id" class="bg-white rounded-lg shadow overflow-hidden max-w-3xl">
          <!-- Header -->
          <div class="px-6 py-3 border-b border-gray-200 flex items-center justify-between bg-blue-50">
            <div class="flex items-center gap-2">
              <i class="fab fa-microsoft text-blue-500 text-sm"></i>
              <span class="font-semibold text-gray-900 text-sm">Tenant {{ t.tenant_id }}</span>
              <span class="text-xs text-gray-500">{{ t.bc_company || 'Sin configurar' }}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium" :class="getStatus(t).class">
                {{ getStatus(t).label }}
              </span>
              <button @click="deleteTenant(t)" class="text-gray-400 hover:text-red-600 transition p-1">
                <i class="fas fa-trash text-xs"></i>
              </button>
            </div>
          </div>

          <!-- Body -->
          <div class="p-5 space-y-3">
            <!-- Enable toggle -->
            <div class="flex items-center justify-between p-2 bg-gray-50 rounded">
              <span class="text-xs font-medium text-gray-700">Activar integracion</span>
              <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" v-model="t.enabled" class="sr-only peer">
                <div class="w-9 h-5 bg-gray-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            <!-- Config fields -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-gray-600 mb-1">Client ID (Application ID)</label>
                <input v-model="t.client_id" type="text" placeholder="b75e6ab5-..."
                  class="w-full px-2.5 py-1.5 border border-gray-300 rounded text-sm font-mono text-xs">
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-600 mb-1">Client Secret</label>
                <input v-model="t.client_secret" type="password" placeholder="Dejar vacio para mantener"
                  class="w-full px-2.5 py-1.5 border border-gray-300 rounded text-sm">
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-600 mb-1">Azure Tenant ID</label>
                <input v-model="t.azure_tenant_id" type="text" placeholder="ee91818c-..."
                  class="w-full px-2.5 py-1.5 border border-gray-300 rounded text-sm font-mono text-xs">
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-600 mb-1">Environment</label>
                <input v-model="t.bc_environment" type="text" placeholder="Production"
                  class="w-full px-2.5 py-1.5 border border-gray-300 rounded text-sm">
              </div>
              <div class="col-span-2">
                <label class="block text-xs font-medium text-gray-600 mb-1">Company</label>
                <input v-model="t.bc_company" type="text" placeholder="VITOGAS_2017"
                  class="w-full px-2.5 py-1.5 border border-gray-300 rounded text-sm">
              </div>
            </div>

            <!-- Connection test result -->
            <div v-if="t.testResult" class="p-3 rounded text-xs"
              :class="t.testResult.success ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'">
              {{ t.testResult.message }}
              <span v-if="t.testResult.error"> - {{ t.testResult.error }}</span>
            </div>

            <!-- Test Screen Pop -->
            <div v-if="t.enabled && t.has_secret" class="p-3 bg-blue-50 rounded border border-blue-100">
              <p class="text-xs font-medium text-blue-700 mb-2"><i class="fas fa-external-link-alt mr-1"></i>Test Screen Pop (ObtenerURL)</p>
              <div class="flex items-center gap-2">
                <input v-model="t.testPhone" type="text" placeholder="Telefono (ej: 677869052)"
                  class="flex-1 px-2.5 py-1.5 border border-blue-200 rounded text-sm" @keyup.enter="testUrl(t)">
                <button @click="testUrl(t)" :disabled="t.testingUrl || !t.testPhone"
                  class="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition disabled:opacity-50 text-xs font-medium whitespace-nowrap">
                  <i class="fas fa-search mr-1" :class="{ 'fa-spin': t.testingUrl }"></i>{{ t.testingUrl ? 'Buscando...' : 'Buscar' }}
                </button>
              </div>
              <div v-if="t.urlResult" class="mt-2 p-2 rounded text-xs"
                :class="t.urlResult.found ? 'bg-green-50 border border-green-200' : 'bg-orange-50 border border-orange-200'">
                <template v-if="t.urlResult.found">
                  <p class="text-green-800 mb-1"><i class="fas fa-check-circle mr-1"></i>Contacto encontrado</p>
                  <a :href="t.urlResult.bcUrl" target="_blank" class="text-blue-600 hover:text-blue-800 underline break-all">{{ t.urlResult.bcUrl }}</a>
                </template>
                <template v-else>
                  <p class="text-orange-700"><i class="fas fa-info-circle mr-1"></i>ObtenerURL devolvio vacio para {{ t.urlResult.phone }}</p>
                </template>
              </div>
            </div>
          </div>

          <!-- Footer actions -->
          <div class="px-5 py-3 bg-gray-50 border-t flex justify-between">
            <button @click="testConnection(t)" :disabled="t.testing || !t.client_id || !t.azure_tenant_id || !t.bc_environment || !t.bc_company"
              class="px-3 py-1.5 border border-gray-300 text-gray-700 rounded hover:bg-gray-100 transition disabled:opacity-50 text-xs font-medium">
              <i class="fas fa-flask mr-1" :class="{ 'fa-spin': t.testing }"></i>{{ t.testing ? 'Probando...' : 'Probar Conexion' }}
            </button>
            <button @click="saveConfig(t)" :disabled="t.saving || !t.client_id || !t.azure_tenant_id || !t.bc_environment || !t.bc_company"
              class="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition disabled:opacity-50 text-xs font-medium">
              <i class="fas fa-save mr-1" :class="{ 'fa-spin': t.saving }"></i>{{ t.saving ? 'Guardando...' : 'Guardar' }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../services/api.js'

const loading = ref(true)
const configs = ref([])
const showAdd = ref(false)
const newTid = ref('')

function getStatus(t) {
  if (t.testResult?.success) return { label: 'Conectado', class: 'bg-green-100 text-green-800' }
  if (!t.saved) return { label: 'Sin guardar', class: 'bg-orange-100 text-orange-800' }
  if (t.enabled && t.has_secret) return { label: 'Activo', class: 'bg-blue-100 text-blue-800' }
  if (t.has_secret) return { label: 'Guardado (inactivo)', class: 'bg-gray-100 text-gray-600' }
  return { label: 'Sin configurar', class: 'bg-gray-100 text-gray-600' }
}

async function loadConfigs() {
  loading.value = true
  try {
    const { data } = await api.get('/bc/tenants')
    configs.value = []
    for (const t of data.tenants) {
      const { data: config } = await api.get(`/bc/config/${t.tenant_id}`)
      configs.value.push({
        ...config,
        enabled: config.enabled === '1' || config.enabled === true,
        client_secret: '',
        saved: true,
        testResult: null,
        saving: false,
        testing: false,
        testPhone: '',
        testingUrl: false,
        urlResult: null
      })
    }
  } catch (e) {
    console.error('Load configs:', e)
  } finally {
    loading.value = false
  }
}

function addTenant() {
  const tid = newTid.value.trim()
  if (!tid || configs.value.some(t => t.tenant_id === tid)) return
  configs.value.push({
    tenant_id: tid,
    client_id: '',
    client_secret: '',
    azure_tenant_id: '',
    bc_environment: 'Production',
    bc_company: '',
    enabled: false,
    has_secret: false,
    saved: false,
    testResult: null,
    saving: false,
    testing: false,
    testPhone: '',
    testingUrl: false,
    urlResult: null
  })
  newTid.value = ''
  showAdd.value = false
}

async function saveConfig(t) {
  try {
    t.saving = true
    t.testResult = null
    await api.put(`/bc/config/${t.tenant_id}`, {
      client_id: t.client_id,
      client_secret: t.client_secret,
      azure_tenant_id: t.azure_tenant_id,
      bc_environment: t.bc_environment,
      bc_company: t.bc_company,
      enabled: t.enabled
    })
    t.has_secret = true
    t.saved = true
    if (t.client_secret) t.client_secret = ''
    t.testResult = { success: true, message: 'Configuracion guardada correctamente' }
  } catch (e) {
    t.testResult = { success: false, message: 'Error al guardar', error: e.response?.data?.error || e.message }
    console.error('Save config:', e)
  } finally {
    t.saving = false
  }
}

async function testConnection(t) {
  try {
    t.testing = true
    t.testResult = null
    const payload = {
      client_id: t.client_id,
      azure_tenant_id: t.azure_tenant_id,
      bc_environment: t.bc_environment,
      bc_company: t.bc_company
    }
    if (t.client_secret) payload.client_secret = t.client_secret
    const { data } = await api.post(`/bc/test/${t.tenant_id}`, payload)
    t.testResult = data
  } catch (e) {
    t.testResult = { success: false, message: 'Error de conexion', error: e.response?.data?.error || e.message }
  } finally {
    t.testing = false
  }
}

async function testUrl(t) {
  try {
    t.testingUrl = true
    t.urlResult = null
    const { data } = await api.get(`/bc/test-url/${t.tenant_id}?phone=${encodeURIComponent(t.testPhone.trim())}`)
    t.urlResult = data
  } catch (e) {
    t.urlResult = { found: false, phone: t.testPhone, error: e.response?.data?.error || e.message }
  } finally {
    t.testingUrl = false
  }
}

async function deleteTenant(t) {
  if (!confirm(`Eliminar config BC para tenant ${t.tenant_id}?`)) return
  try {
    await api.delete(`/bc/config/${t.tenant_id}`)
    configs.value = configs.value.filter(x => x.tenant_id !== t.tenant_id)
  } catch (e) {
    console.error('Delete:', e)
  }
}

onMounted(() => { loadConfigs() })
</script>
