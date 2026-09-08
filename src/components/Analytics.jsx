import { useEffect } from 'react'

const ANALYTICS_URL = import.meta.env.VITE_UMAMI_URL || 'https://cloud.umami.is/script.js'
const WEBSITE_ID = import.meta.env.VITE_UMAMI_ID || ''

export default function Analytics() {
  useEffect(() => {
    if (!WEBSITE_ID) return undefined
    if (document.getElementById('umami-script')) return undefined
    const s = document.createElement('script')
    s.id = 'umami-script'
    s.async = true
    s.src = ANALYTICS_URL
    s.dataset.websiteId = WEBSITE_ID
    document.head.appendChild(s)
    return () => {
      const el = document.getElementById('umami-script')
      if (el) el.remove()
    }
  }, [])
  return null
}
