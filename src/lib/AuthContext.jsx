import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { isSupabase, supabase } from './supabase'
import { localDb } from './local'
import { uid } from './format'

const AuthContext = createContext(null)

function recoveryLinkPresent() {
  try {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const query = new URLSearchParams(window.location.search)
    return hash.get('type') === 'recovery' || query.get('type') === 'recovery'
  } catch {
    return false
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [store, setStore] = useState(null)
  const [products, setProducts] = useState([])
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [recovering, setRecovering] = useState(false)

  async function loadLocal(sessionUser) {
    const nextUser = sessionUser || localDb.currentUser()
    setUser(nextUser)
    if (!nextUser) {
      setStore(null)
      setProducts([])
      setOrders([])
      return
    }
    const s = localDb.storeByOwner(nextUser.id)
    setStore(s)
    setProducts(s ? localDb.productsByStore(s.id) : [])
    setOrders(s ? localDb.ordersByStore(s.id) : [])
  }

  async function loadSupabase(sessionUser) {
    setUser(sessionUser)
    if (!sessionUser) {
      setStore(null)
      setProducts([])
      setOrders([])
      return
    }
    const { data: storeRow } = await supabase
      .from('stores')
      .select('*')
      .eq('owner_id', sessionUser.id)
      .maybeSingle()
    setStore(storeRow)
    if (!storeRow) {
      setProducts([])
      setOrders([])
      return
    }
    const [{ data: productRows }, { data: orderRows }] = await Promise.all([
      supabase.from('products').select('*').eq('store_id', storeRow.id).order('sort'),
      supabase.from('orders').select('*').eq('store_id', storeRow.id).order('created_at', { ascending: false })
    ])
    setProducts(productRows || [])
    setOrders(orderRows || [])
  }

  async function refresh() {
    if (isSupabase) {
      const { data } = await supabase.auth.getUser()
      await loadSupabase(data.user)
    } else {
      await loadLocal()
    }
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        if (isSupabase) {
          const recoveringNow = recoveryLinkPresent()
          const { data } = await supabase.auth.getSession()
          if (!alive) return
          if (recoveringNow) {
            setRecovering(true)
          } else {
            await loadSupabase(data.session?.user || null)
          }
          if (!alive) return
          supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'PASSWORD_RECOVERY') {
              setRecovering(true)
              setUser(null)
              setStore(null)
              return
            }
            loadSupabase(session?.user || null)
          })
        } else {
          await loadLocal()
        }
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const api = useMemo(
    () => ({
      user,
      store,
      products,
      orders,
      loading,
      recovering,
      isSupabase,
      refresh,
      addOrder(row) {
        setOrders((prev) => {
          if (prev.some((o) => o.id === row.id)) return prev
          return [row, ...prev]
        })
      },
      applyOrderPatch(id, patch) {
        setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)))
      },
      clearRecovery() {
        setRecovering(false)
      },
      async updatePassword(password) {
        if (!isSupabase) throw new Error('Modo local não usa recuperação.')
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error
        setRecovering(false)
        const { data } = await supabase.auth.getUser()
        await loadSupabase(data.user)
      },
      async signUp({ email, password, name }) {
        if (isSupabase) {
          const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { name } }
          })
          if (error) throw error
          if (!data.session) {
            throw new Error('Conta criada. Confirme o e-mail (ou desligue Confirm email no Supabase) e entre de novo.')
          }
          await loadSupabase(data.session.user)
          return data.session.user
        }
        const existing = localDb.get().users.find((u) => u.email === email)
        if (existing) throw new Error('Esse e-mail já está cadastrado.')
        const next = { id: uid('user'), email, password, name }
        localDb.upsertUser(next)
        await loadLocal(next)
        return next
      },
      async signIn({ email, password }) {
        if (isSupabase) {
          const { data, error } = await supabase.auth.signInWithPassword({ email, password })
          if (error) throw error
          await loadSupabase(data.user)
          return data.user
        }
        const found = localDb.get().users.find((u) => u.email === email && u.password === password)
        if (!found) throw new Error('E-mail ou senha inválidos.')
        localDb.setSession(email)
        await loadLocal(found)
        return found
      },
      async signOut() {
        if (isSupabase) await supabase.auth.signOut()
        else localDb.setSession(null)
        setUser(null)
        setStore(null)
        setProducts([])
        setOrders([])
      },
      async saveStore(next) {
        if (isSupabase) {
          const { data: authData, error: authError } = await supabase.auth.getUser()
          if (authError || !authData.user) throw new Error('Sessão expirada. Entre de novo.')
          const row = { ...next, owner_id: authData.user.id }
          delete row.created_at
          let result
          if (row.id) {
            const { id, ...patch } = row
            result = await supabase.from('stores').update(patch).eq('id', id).select().single()
          } else {
            delete row.id
            result = await supabase.from('stores').insert(row).select().single()
          }
          if (result.error) throw result.error
          setStore(result.data)
          return result.data
        }
        const saved = localDb.saveStore(next)
        setStore(saved)
        return saved
      },
      async saveProduct(next) {
        if (isSupabase) {
          const row = { ...next }
          let result
          if (row.id) {
            const { id, ...patch } = row
            result = await supabase.from('products').update(patch).eq('id', id).select().single()
          } else {
            delete row.id
            result = await supabase.from('products').insert(row).select().single()
          }
          if (result.error) throw result.error
          const data = result.data
          setProducts((prev) => {
            const i = prev.findIndex((p) => p.id === data.id)
            if (i >= 0) {
              const copy = [...prev]
              copy[i] = data
              return copy
            }
            return [...prev, data].sort((a, b) => (a.sort || 0) - (b.sort || 0))
          })
          return data
        }
        const saved = localDb.saveProduct(next)
        setProducts(localDb.productsByStore(saved.store_id))
        return saved
      },
      async deleteProduct(id) {
        if (isSupabase) {
          const { error } = await supabase.from('products').delete().eq('id', id)
          if (error) throw error
        } else {
          localDb.deleteProduct(id)
        }
        setProducts((prev) => prev.filter((p) => p.id !== id))
      },
      async saveOrder(next) {
        if (isSupabase) {
          const row = { ...next }
          if (!row.id) delete row.id
          const { data, error } = await supabase.from('orders').insert(row).select().single()
          if (error) throw error
          setOrders((prev) => [data, ...prev])
          return data
        }
        const saved = localDb.saveOrder(next)
        setOrders(localDb.ordersByStore(saved.store_id))
        return saved
      },
      async updateOrder(id, patch) {
        if (isSupabase) {
          const { data, error } = await supabase.from('orders').update(patch).eq('id', id).select().single()
          if (error) throw error
          setOrders((prev) => prev.map((o) => (o.id === id ? data : o)))
          return data
        }
        localDb.updateOrder(id, patch)
        if (store) setOrders(localDb.ordersByStore(store.id))
      }
    }),
    [user, store, products, orders, loading]
  )

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
