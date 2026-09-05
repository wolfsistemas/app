export const DEMO_STORE = {
  id: 'store_ana',
  owner_id: 'demo_ana',
  slug: 'ana-atelier',
  name: 'Ana Ateliê',
  bio: 'Peças feitas à mão, envio para todo o Brasil. Encomendas pelo WhatsApp.',
  whatsapp: '11987654321',
  pix_key: 'ana@atelier.com',
  instagram: 'ana.atelier',
  theme: 'bosque',
  avatar_url: '',
  cover_url: '',
  plan: 'pro',
  links: [
    { id: 'l1', label: 'Instagram', url: 'https://instagram.com/ana.atelier' },
    { id: 'l2', label: 'Avaliações', url: 'https://instagram.com/ana.atelier' }
  ],
  created_at: '2026-08-12T12:00:00.000Z'
}

export const DEMO_PRODUCTS = [
  {
    id: 'p1',
    store_id: 'store_ana',
    name: 'Vestido Linho Cru',
    description: 'Tecido leve, caimento solto. Tamanhos P ao GG.',
    price: 189.9,
    compare_at: 229.9,
    category: 'Vestidos',
    photo_url: 'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?auto=format&fit=crop&w=800&q=80',
    active: true,
    sort: 1
  },
  {
    id: 'p2',
    store_id: 'store_ana',
    name: 'Bolsa Palha Praia',
    description: 'Palha natural, forro de algodão, alça ajustável.',
    price: 129,
    compare_at: 0,
    category: 'Bolsas',
    photo_url: 'https://images.unsplash.com/photo-1590874103328-eac38a941954?auto=format&fit=crop&w=800&q=80',
    active: true,
    sort: 2
  },
  {
    id: 'p3',
    store_id: 'store_ana',
    name: 'Colar Pérola Barroca',
    description: 'Banho ouro 18k, pérola natural. Hipoalergênico.',
    price: 79.9,
    compare_at: 99.9,
    category: 'Joias',
    photo_url: 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=800&q=80',
    active: true,
    sort: 3
  },
  {
    id: 'p4',
    store_id: 'store_ana',
    name: 'Kimono Floral',
    description: 'Viscose fluida, estampa exclusiva do ateliê.',
    price: 159,
    compare_at: 0,
    category: 'Vestidos',
    photo_url: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=800&q=80',
    active: true,
    sort: 4
  },
  {
    id: 'p5',
    store_id: 'store_ana',
    name: 'Cinto Couro Caramelo',
    description: 'Couro legítimo, fivela dourada. Cintura 70 a 95.',
    price: 89,
    compare_at: 0,
    category: 'Acessórios',
    photo_url: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=800&q=80',
    active: true,
    sort: 5
  },
  {
    id: 'p6',
    store_id: 'store_ana',
    name: 'Brinco Argola Fosca',
    description: 'Banho ouro, 4 cm. Leve para o dia a dia.',
    price: 49.9,
    compare_at: 69.9,
    category: 'Joias',
    photo_url: 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=800&q=80',
    active: true,
    sort: 6
  }
]

export const DEMO_ORDERS = [
  {
    id: 'o1',
    store_id: 'store_ana',
    customer_name: 'Mariana Costa',
    items: [{ name: 'Vestido Linho Cru', qty: 1, price: 189.9 }],
    note: 'Tamanho M, retirar sexta',
    total: 189.9,
    status: 'novo',
    created_at: new Date(Date.now() - 1000 * 60 * 42).toISOString()
  },
  {
    id: 'o2',
    store_id: 'store_ana',
    customer_name: 'Letícia Ramos',
    items: [
      { name: 'Colar Pérola Barroca', qty: 1, price: 79.9 },
      { name: 'Brinco Argola Fosca', qty: 1, price: 49.9 }
    ],
    note: '',
    total: 129.8,
    status: 'atendido',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString()
  }
]
