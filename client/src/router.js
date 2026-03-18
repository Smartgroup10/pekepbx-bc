import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from './stores/auth.js'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('./views/LoginView.vue')
  },
  {
    path: '/',
    redirect: () => {
      const user = JSON.parse(localStorage.getItem('user') || 'null')
      return user?.role === 'admin' ? '/dashboard' : '/panel'
    }
  },
  {
    path: '/panel',
    name: 'UserPanel',
    component: () => import('./views/UserPanelView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/dashboard',
    component: () => import('./components/AppLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', name: 'Dashboard', component: () => import('./views/DashboardView.vue') },
      { path: '/settings', name: 'Settings', component: () => import('./views/SettingsView.vue'), meta: { admin: true } },
      { path: '/users', name: 'Users', component: () => import('./views/UsersView.vue'), meta: { admin: true } }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to, from, next) => {
  const auth = useAuthStore()

  if (to.meta.requiresAuth && !auth.token) {
    return next('/login')
  }

  if (to.meta.admin && auth.user?.role !== 'admin') {
    return next('/panel')
  }

  if (to.path === '/login' && auth.token) {
    return next(auth.isAdmin ? '/dashboard' : '/panel')
  }

  // Admin trying to access /panel → redirect to /dashboard
  if (to.path === '/panel' && auth.isAdmin) {
    return next('/dashboard')
  }

  next()
})

export default router
