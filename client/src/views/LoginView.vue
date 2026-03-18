<template>
  <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100">
    <div class="bg-white rounded-xl shadow-lg p-8 w-full max-w-sm">
      <div class="text-center mb-6">
        <div class="w-14 h-14 bg-blue-600 rounded-xl flex items-center justify-center mx-auto mb-3">
          <i class="fab fa-microsoft text-white text-2xl"></i>
        </div>
        <h1 class="text-xl font-bold text-gray-900">PekePBX-BC</h1>
        <p class="text-xs text-gray-500 mt-1">Business Central Integration</p>
      </div>

      <form @submit.prevent="handleLogin" class="space-y-4">
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">Usuario</label>
          <input v-model="username" type="text" required autofocus
            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
            placeholder="admin">
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">Contrasena</label>
          <input v-model="password" type="password" required
            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
            placeholder="********">
        </div>
        <div v-if="error" class="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {{ error }}
        </div>
        <button type="submit" :disabled="loading"
          class="w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium text-sm disabled:opacity-50">
          <i v-if="loading" class="fas fa-spinner fa-spin mr-1"></i>
          {{ loading ? 'Entrando...' : 'Entrar' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'

const router = useRouter()
const auth = useAuthStore()

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function handleLogin() {
  error.value = ''
  loading.value = true
  try {
    await auth.login(username.value, password.value)
    router.push(auth.isAdmin ? '/dashboard' : '/panel')
  } catch (err) {
    error.value = err.response?.data?.error || 'Error de conexion'
  } finally {
    loading.value = false
  }
}
</script>
