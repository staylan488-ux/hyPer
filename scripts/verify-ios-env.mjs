import { existsSync, readFileSync } from 'node:fs'

const STAGING_PROJECT_REF = 'nwvgkxqjqihqnjuworqz'

function parseEnvFile(path) {
  if (!existsSync(path)) return {}

  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=')
        const key = line.slice(0, separator).trim()
        const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
        return [key, value]
      }),
  )
}

const environment = {
  ...parseEnvFile('.env'),
  ...parseEnvFile('.env.local'),
  ...process.env,
}

const url = environment.VITE_SUPABASE_URL
const clientKey = environment.VITE_SUPABASE_ANON_KEY

if (!url || !clientKey) {
  throw new Error('iOS builds require the Hyper-Dev Supabase URL and public client key in .env.local.')
}

let projectRef
try {
  const hostname = new URL(url).hostname
  projectRef = hostname.endsWith('.supabase.co') ? hostname.split('.')[0] : null
} catch {
  projectRef = null
}

if (projectRef !== STAGING_PROJECT_REF) {
  throw new Error('iOS builds are locked to Hyper-Dev. Refusing to build against another Supabase project.')
}

console.log('iOS environment check passed: Hyper-Dev selected.')
