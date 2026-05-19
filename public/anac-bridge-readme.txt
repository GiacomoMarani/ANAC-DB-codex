/**
 * public/anac-bridge.html
 *
 * Pagina bridge per ottenere le credenziali ANAC via window.opener.
 *
 * FLUSSO:
 * 1. Il componente apre una popup: window.open('/anac-bridge.html', ...)
 * 2. anac-bridge.html è caricato da localhost:3000
 * 3. La pagina bridge usa un iframe nascosto che punta a ANAC
 * 4. L'iframe carica /api/v1/security/csrf_token/ su dati.anticorruzione.it
 * 5. L'iframe non è leggibile per CORS — ma possiamo usare un altro approccio:
 *    la pagina bridge usa fetch con mode: 'no-cors' per settare i cookie
 *    e poi reindirizza a ANAC stesso.
 *
 * SOLUZIONE FINALE: redirect a ANAC con postMessage al ritorno
 */
