'use client'

import { useEffect, useState } from 'react'
import App from '../src/App'

export function ReliefForgeClient() {
  const [browserReady, setBrowserReady] = useState(false)

  useEffect(() => {
    setBrowserReady(true)
  }, [])

  return (
    <div id="root" data-relief-forge-access="allowed">
      {browserReady
        ? <App />
        : (
            <main className="friend-access-shell" aria-busy="true">
              <section className="friend-access-card">
                <small>RELIEF FORGE WEBMCP CHALLENGE</small>
                <h1>Opening the studio</h1>
                <p>Your signed-in design workspace is loading in this browser.</p>
              </section>
            </main>
          )}
    </div>
  )
}
