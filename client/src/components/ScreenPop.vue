<template>
  <!-- Popup blocked banner -->
  <div v-if="popupBlocked" class="fixed top-0 left-0 right-0 z-[60] bg-amber-500 text-white text-center py-2 px-4 text-sm shadow-lg">
    <i class="fas fa-exclamation-triangle mr-2"></i>
    El navegador bloquea la apertura automatica.
    <strong>Permite ventanas emergentes</strong> para este sitio (icono en la barra de direcciones).
    <button @click="popupBlocked = false" class="ml-3 underline hover:no-underline">Entendido</button>
  </div>

  <Transition enter-active-class="transition duration-300 ease-out" enter-from-class="translate-y-2 opacity-0" enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition duration-200 ease-in" leave-from-class="translate-y-0 opacity-100" leave-to-class="translate-y-2 opacity-0">
    <div v-if="visible" class="fixed bottom-4 right-4 z-50 w-80 bg-white rounded-xl shadow-2xl border overflow-hidden">
      <!-- Header -->
      <div class="px-4 py-3 flex items-center justify-between" :class="headerBgClass">
        <div class="flex items-center gap-2">
          <i :class="headerIconClass"></i>
          <span class="text-sm font-semibold" :class="headerTextClass">
            {{ headerLabel }}
          </span>
        </div>
        <button @click="dismiss" class="text-gray-400 hover:text-gray-600 transition">
          <i class="fas fa-times text-xs"></i>
        </button>
      </div>

      <!-- Body -->
      <div class="p-4">
        <p class="text-lg font-bold text-gray-900 mb-1">{{ phone }}</p>
        <p v-if="name" class="text-sm text-gray-600 mb-1">{{ name }}</p>

        <!-- Contact found (green) -->
        <template v-if="type === 'contact'">
          <p class="text-xs text-gray-500 mb-3">Se abrira la ficha en Business Central</p>
          <div class="flex gap-2">
            <a :href="bcUrl" target="bc_window" @click="dismiss"
              class="flex-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-xs font-medium text-center">
              <i class="fab fa-microsoft mr-1"></i>Abrir ficha
            </a>
            <button @click="dismiss"
              class="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition text-xs font-medium">
              Cerrar
            </button>
          </div>
        </template>

        <!-- Vendor found (blue/violet) -->
        <template v-else-if="type === 'vendor'">
          <p class="text-xs text-gray-500 mb-3">Se abrira la ficha de proveedor en Business Central</p>
          <div class="flex gap-2">
            <a :href="bcUrl" target="bc_window" @click="dismiss"
              class="flex-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-xs font-medium text-center">
              <i class="fas fa-truck mr-1"></i>Abrir proveedor
            </a>
            <button @click="dismiss"
              class="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition text-xs font-medium">
              Cerrar
            </button>
          </div>
        </template>

        <!-- Not found (orange) -->
        <template v-else>
          <p class="text-xs text-gray-500 mb-3">Este numero no esta registrado en Business Central</p>
          <div class="flex flex-col gap-2">
            <a :href="newContactUrl" target="bc_window" @click="dismiss"
              class="w-full px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-xs font-medium text-center">
              <i class="fas fa-user-plus mr-1"></i>Crear contacto en BC
            </a>
            <div class="flex gap-2">
              <a :href="bcUrl" target="bc_window" @click="dismiss"
                class="flex-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-xs font-medium text-center">
                <i class="fab fa-microsoft mr-1"></i>Abrir BC
              </a>
              <button @click="dismiss"
                class="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition text-xs font-medium">
                Cerrar
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </Transition>

  <!-- Hidden link for auto-open (click triggered programmatically) -->
  <a ref="autoOpenLink" style="display:none" target="bc_window"></a>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import sseClient from '../services/sse.js'

const visible = ref(false)
const phone = ref('')
const bcUrl = ref('')
const found = ref(false)
const type = ref(null) // 'contact' | 'vendor' | null
const name = ref('')
const newContactUrl = ref('')
const popupBlocked = ref(false)
const autoOpenLink = ref(null)

const headerBgClass = computed(() => {
  if (type.value === 'contact') return 'bg-green-50 border-b border-green-100'
  if (type.value === 'vendor') return 'bg-indigo-50 border-b border-indigo-100'
  return 'bg-orange-50 border-b border-orange-100'
})

const headerIconClass = computed(() => {
  if (type.value === 'contact') return 'fas fa-phone-volume text-green-600'
  if (type.value === 'vendor') return 'fas fa-truck text-indigo-600'
  return 'fas fa-phone-volume text-orange-500'
})

const headerTextClass = computed(() => {
  if (type.value === 'contact') return 'text-green-800'
  if (type.value === 'vendor') return 'text-indigo-800'
  return 'text-orange-800'
})

const headerLabel = computed(() => {
  if (type.value === 'contact') return 'Contacto encontrado'
  if (type.value === 'vendor') return 'Proveedor encontrado'
  return 'Contacto no encontrado'
})

let dismissTimer = null
let unsubscribe = null

function tryAutoOpen(url) {
  if (!url) return

  // Method 1: Try window.open with named window (reuses same tab)
  const newWin = window.open(url, 'bc_window')
  if (newWin) {
    // Worked — popup allowed
    return
  }

  // Method 2: Programmatic link click (works in some browsers)
  if (autoOpenLink.value) {
    autoOpenLink.value.href = url
    autoOpenLink.value.click()
  }

  // If both fail, show banner
  popupBlocked.value = true
}

function handleScreenPop(data) {
  phone.value = data.phone
  bcUrl.value = data.bcUrl
  found.value = data.found
  type.value = data.type || (data.found ? 'contact' : null)
  name.value = data.name || ''
  newContactUrl.value = data.newContactUrl || data.bcUrl
  visible.value = true

  // Auto-open: ficha if found (contact or vendor), BC create page if not found
  if (data.found && data.bcUrl) {
    tryAutoOpen(data.bcUrl)
  } else if (data.newContactUrl) {
    tryAutoOpen(data.newContactUrl)
  }

  // Auto-dismiss
  clearTimeout(dismissTimer)
  dismissTimer = setTimeout(() => { visible.value = false }, data.found ? 15000 : 30000)
}

function dismiss() {
  visible.value = false
  clearTimeout(dismissTimer)
}

onMounted(() => {
  unsubscribe = sseClient.on('bc_screen_pop', handleScreenPop)
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
  clearTimeout(dismissTimer)
})
</script>
