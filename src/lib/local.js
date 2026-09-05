import { DEMO_ORDERS, DEMO_PRODUCTS, DEMO_STORE } from './seed'

const KEY = 'vitrinezap.v1'

function empty() {
  return {
    users: [],
    sessionEmail: null,
    stores: [DEMO_STORE],
    products: DEMO_PRODUCTS,
    orders: DEMO_ORDERS
  }
}

function read() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      const seed = empty()
      localStorage.setItem(KEY, JSON.stringify(seed))
      return seed
    }
    const data = JSON.parse(raw)
    if (!data.stores?.length) {
      data.stores = [DEMO_STORE]
      data.products = data.products?.length ? data.products : DEMO_PRODUCTS
      data.orders = data.orders?.length ? data.orders : DEMO_ORDERS
    }
    return data
  } catch {
    const seed = empty()
    localStorage.setItem(KEY, JSON.stringify(seed))
    return seed
  }
}

function write(data) {
  localStorage.setItem(KEY, JSON.stringify(data))
  return data
}

export const localDb = {
  get() {
    return read()
  },
  save(data) {
    return write(data)
  },
  currentUser() {
    const db = read()
    return db.users.find((u) => u.email === db.sessionEmail) || null
  },
  setSession(email) {
    const db = read()
    db.sessionEmail = email
    write(db)
  },
  upsertUser(user) {
    const db = read()
    const i = db.users.findIndex((u) => u.email === user.email)
    if (i >= 0) db.users[i] = { ...db.users[i], ...user }
    else db.users.push(user)
    db.sessionEmail = user.email
    write(db)
    return user
  },
  storeByOwner(ownerId) {
    return read().stores.find((s) => s.owner_id === ownerId) || null
  },
  storeBySlug(slug) {
    return read().stores.find((s) => s.slug === slug) || null
  },
  saveStore(store) {
    const db = read()
    const i = db.stores.findIndex((s) => s.id === store.id)
    if (i >= 0) db.stores[i] = store
    else db.stores.push(store)
    write(db)
    return store
  },
  productsByStore(storeId) {
    return read()
      .products.filter((p) => p.store_id === storeId)
      .sort((a, b) => (a.sort || 0) - (b.sort || 0))
  },
  saveProduct(product) {
    const db = read()
    const i = db.products.findIndex((p) => p.id === product.id)
    if (i >= 0) db.products[i] = product
    else db.products.push(product)
    write(db)
    return product
  },
  deleteProduct(id) {
    const db = read()
    db.products = db.products.filter((p) => p.id !== id)
    write(db)
  },
  ordersByStore(storeId) {
    return read()
      .orders.filter((o) => o.store_id === storeId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  },
  saveOrder(order) {
    const db = read()
    db.orders.unshift(order)
    write(db)
    return order
  },
  updateOrder(id, patch) {
    const db = read()
    const i = db.orders.findIndex((o) => o.id === id)
    if (i >= 0) db.orders[i] = { ...db.orders[i], ...patch }
    write(db)
  },
  slugTaken(slug, exceptId) {
    return read().stores.some((s) => s.slug === slug && s.id !== exceptId)
  }
}
