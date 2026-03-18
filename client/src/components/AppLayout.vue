<template>
  <div class="min-h-screen flex">
    <!-- Sidebar -->
    <aside class="w-56 bg-gray-900 text-white flex flex-col">
      <div class="px-5 py-4 border-b border-gray-700">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <i class="fab fa-microsoft text-sm"></i>
          </div>
          <div>
            <h1 class="text-sm font-bold">PekePBX-BC</h1>
            <p class="text-[10px] text-gray-400">Business Central</p>
          </div>
        </div>
      </div>

      <nav class="flex-1 p-3 space-y-1">
        <router-link to="/"
          class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition"
          :class="$route.path === '/' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'">
          <i class="fas fa-desktop w-4 text-center"></i>
          <span>Dashboard</span>
        </router-link>

        <template v-if="auth.isAdmin">
          <router-link to="/settings"
            class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition"
            :class="$route.path === '/settings' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'">
            <i class="fas fa-cog w-4 text-center"></i>
            <span>Configuracion BC</span>
          </router-link>

          <router-link to="/users"
            class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition"
            :class="$route.path === '/users' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'">
            <i class="fas fa-users w-4 text-center"></i>
            <span>Usuarios</span>
          </router-link>
        </template>
      </nav>

      <!-- SSE status + user -->
      <div class="p-3 border-t border-gray-700">
        <div class="flex items-center gap-2 text-xs text-gray-400 mb-2">
          <span class="w-2 h-2 rounded-full" :class="auth.sseConnected ? 'bg-green-400' : 'bg-red-400'"></span>
          SSE {{ auth.sseConnected ? 'conectado' : 'desconectado' }}
        </div>
        <div class="flex items-center justify-between">
          <span class="text-xs text-gray-300 truncate">{{ auth.user?.full_name || auth.user?.username }}</span>
          <button @click="handleLogout" class="text-gray-400 hover:text-white transition" title="Cerrar sesion">
            <i class="fas fa-sign-out-alt text-sm"></i>
          </button>
        </div>
      </div>
    </aside>

    <!-- Main content -->
    <main class="flex-1 overflow-auto bg-gray-50">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'

const router = useRouter()
const auth = useAuthStore()

async function handleLogout() {
  await auth.logout()
  router.push('/login')
}
</script>
