<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">
          <i class="fas fa-users mr-2 text-blue-600"></i>Usuarios
        </h1>
        <p class="text-sm text-gray-600 mt-1">Gestion de usuarios y asignacion de extensiones</p>
      </div>
      <button @click="openModal()" class="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-xs font-medium">
        <i class="fas fa-plus mr-1"></i>Nuevo Usuario
      </button>
    </div>

    <!-- Users table -->
    <div class="bg-white rounded-lg shadow overflow-hidden">
      <div v-if="loading" class="p-8 text-center text-gray-400">
        <i class="fas fa-spinner fa-spin text-xl"></i>
      </div>

      <table v-else class="w-full text-sm">
        <thead class="bg-gray-50 text-left text-xs text-gray-500 uppercase">
          <tr>
            <th class="px-5 py-3">Usuario</th>
            <th class="px-5 py-3">Nombre</th>
            <th class="px-5 py-3">Extension</th>
            <th class="px-5 py-3">SIP Peer</th>
            <th class="px-5 py-3">Tenant</th>
            <th class="px-5 py-3">Rol</th>
            <th class="px-5 py-3">Estado</th>
            <th class="px-5 py-3 text-right">Acciones</th>
          </tr>
        </thead>
        <tbody class="divide-y">
          <tr v-for="u in users" :key="u.id" class="hover:bg-gray-50">
            <td class="px-5 py-3 font-medium text-gray-900">{{ u.username }}</td>
            <td class="px-5 py-3 text-gray-600">{{ u.full_name }}</td>
            <td class="px-5 py-3 text-gray-600 font-mono text-xs">{{ u.extension || '-' }}</td>
            <td class="px-5 py-3 text-gray-600 font-mono text-xs">{{ u.sip_peer || '-' }}</td>
            <td class="px-5 py-3 text-gray-600">{{ u.tenant_id || '-' }}</td>
            <td class="px-5 py-3">
              <span class="px-2 py-0.5 rounded-full text-xs font-medium"
                :class="u.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-600'">
                {{ u.role }}
              </span>
            </td>
            <td class="px-5 py-3">
              <span class="px-2 py-0.5 rounded-full text-xs font-medium"
                :class="u.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'">
                {{ u.active ? 'Activo' : 'Inactivo' }}
              </span>
            </td>
            <td class="px-5 py-3 text-right">
              <button @click="openModal(u)" class="text-blue-600 hover:text-blue-800 mr-2" title="Editar">
                <i class="fas fa-edit text-xs"></i>
              </button>
              <button @click="deleteUser(u)" class="text-red-500 hover:text-red-700" title="Eliminar">
                <i class="fas fa-trash text-xs"></i>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal -->
    <div v-if="showModal" class="fixed inset-0 bg-black/40 flex items-center justify-center z-50" @click.self="showModal = false">
      <div class="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 class="text-lg font-bold text-gray-900 mb-4">
          {{ editingUser ? 'Editar Usuario' : 'Nuevo Usuario' }}
        </h2>

        <div class="space-y-3">
          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">Username</label>
            <input v-model="form.username" type="text" :disabled="!!editingUser"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100">
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">{{ editingUser ? 'Nueva contrasena (vacio = mantener)' : 'Contrasena' }}</label>
            <input v-model="form.password" type="password"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">Nombre completo</label>
            <input v-model="form.full_name" type="text"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">Extension</label>
              <input v-model="form.extension" type="text" placeholder="500"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">SIP Peer</label>
              <input v-model="form.sip_peer" type="text" placeholder="ext20141500"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono text-xs">
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">Tenant ID</label>
              <input v-model="form.tenant_id" type="text" placeholder="20141"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">Rol</label>
              <select v-model="form.role" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </div>
          </div>
          <div v-if="editingUser" class="flex items-center gap-2">
            <input type="checkbox" v-model="form.active" id="active" class="rounded">
            <label for="active" class="text-sm text-gray-700">Activo</label>
          </div>
        </div>

        <div v-if="formError" class="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {{ formError }}
        </div>

        <div class="flex justify-end gap-2 mt-5">
          <button @click="showModal = false"
            class="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition text-sm">
            Cancelar
          </button>
          <button @click="saveUser" :disabled="saving"
            class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm disabled:opacity-50">
            {{ saving ? 'Guardando...' : 'Guardar' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../services/api.js'

const users = ref([])
const loading = ref(true)
const showModal = ref(false)
const editingUser = ref(null)
const saving = ref(false)
const formError = ref('')

const form = ref({
  username: '',
  password: '',
  full_name: '',
  extension: '',
  sip_peer: '',
  tenant_id: '',
  role: 'user',
  active: true
})

async function loadUsers() {
  loading.value = true
  try {
    const { data } = await api.get('/users')
    users.value = data.users
  } catch (e) {
    console.error('Load users:', e)
  } finally {
    loading.value = false
  }
}

function openModal(user = null) {
  editingUser.value = user
  formError.value = ''
  if (user) {
    form.value = {
      username: user.username,
      password: '',
      full_name: user.full_name,
      extension: user.extension || '',
      sip_peer: user.sip_peer || '',
      tenant_id: user.tenant_id || '',
      role: user.role,
      active: !!user.active
    }
  } else {
    form.value = { username: '', password: '', full_name: '', extension: '', sip_peer: '', tenant_id: '', role: 'user', active: true }
  }
  showModal.value = true
}

async function saveUser() {
  formError.value = ''
  saving.value = true
  try {
    if (editingUser.value) {
      const payload = { ...form.value }
      if (!payload.password) delete payload.password
      await api.put(`/users/${editingUser.value.id}`, payload)
    } else {
      if (!form.value.username || !form.value.password) {
        formError.value = 'Username y contrasena requeridos'
        return
      }
      await api.post('/users', form.value)
    }
    showModal.value = false
    await loadUsers()
  } catch (e) {
    formError.value = e.response?.data?.error || 'Error al guardar'
  } finally {
    saving.value = false
  }
}

async function deleteUser(u) {
  if (!confirm(`Eliminar usuario ${u.username}?`)) return
  try {
    await api.delete(`/users/${u.id}`)
    await loadUsers()
  } catch (e) {
    alert(e.response?.data?.error || 'Error al eliminar')
  }
}

onMounted(() => { loadUsers() })
</script>
