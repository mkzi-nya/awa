importScripts("https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.7.57/dist/zip-full.min.js");

const DB_NAME="awa-db"
const STORE="kv"
const KEY_PWDS="pwds_unicode"

let cachedPasswords=[]

function log(...a){console.log("[awa-sw]",...a)}

function idbOpen(){
return new Promise((resolve,reject)=>{
const req=indexedDB.open(DB_NAME,1)
req.onupgradeneeded=()=>{
const db=req.result
if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE)
}
req.onsuccess=()=>resolve(req.result)
req.onerror=()=>reject(req.error)
})
}

async function idbGet(key){
const db=await idbOpen()
return new Promise((resolve,reject)=>{
const tx=db.transaction(STORE,"readonly")
const st=tx.objectStore(STORE)
const req=st.get(key)
req.onsuccess=()=>resolve(req.result??null)
req.onerror=()=>reject(req.error)
})
}

async function idbSet(key,val){
const db=await idbOpen()
return new Promise((resolve,reject)=>{
const tx=db.transaction(STORE,"readwrite")
const st=tx.objectStore(STORE)
const req=st.put(val,key)
req.onsuccess=()=>resolve()
req.onerror=()=>reject(req.error)
})
}

self.addEventListener("install",e=>e.waitUntil(self.skipWaiting()))

self.addEventListener("activate",e=>{
e.waitUntil((async()=>{
await self.clients.claim()
cachedPasswords=await idbGet(KEY_PWDS)||[]
log("activate loaded",cachedPasswords)
})())
})

self.addEventListener("message",event=>{
const d=event.data||{}

if(d.type==="PING"){
log("PING")

event.waitUntil((async()=>{
const cs=await self.clients.matchAll()
for(const c of cs){
c.postMessage({type:"SW_READY"})
}
})())

return
}

if(d.type==="SET_PASSWORDS"){
const list=(d.passwords||[]).map(x=>String(x))
cachedPasswords=list
log("set passwords",list)
event.waitUntil(idbSet(KEY_PWDS,list))
}
})

function isAllowedOrigin(url){
return url.origin==="https://mkzi-nya.github.io"||url.origin==="http://127.0.0.1:8000"
}

function isPlaintextBypass(url){
const p=url.pathname
return p==="/awa/index.html"||p==="/awa/sw.js"||p==="/awa/main/main.txt"
}

function shouldHandle(url){
if(!isAllowedOrigin(url))return false
if(!url.pathname.startsWith("/awa/"))return false
if(isPlaintextBypass(url))return false
return true
}

function hasExtension(p){
const last=p.split("/").pop()||""
return last.includes(".")
}

function isNavigationRequest(r){
return r.mode==="navigate"||r.destination==="document"
}

function guessContentTypeByPath(p){
p=p.toLowerCase()
if(p.endsWith(".html")||p.endsWith(".htm"))return"text/html; charset=utf-8"
if(p.endsWith(".css"))return"text/css; charset=utf-8"
if(p.endsWith(".js")||p.endsWith(".mjs"))return"text/javascript; charset=utf-8"
if(p.endsWith(".json"))return"application/json; charset=utf-8"
if(p.endsWith(".xml"))return"application/xml; charset=utf-8"
if(p.endsWith(".txt"))return"text/plain; charset=utf-8"
if(p.endsWith(".svg"))return"image/svg+xml"
if(p.endsWith(".png"))return"image/png"
if(p.endsWith(".jpg")||p.endsWith(".jpeg"))return"image/jpeg"
if(p.endsWith(".webp"))return"image/webp"
if(p.endsWith(".gif"))return"image/gif"
if(p.endsWith(".bmp"))return"image/bmp"
if(p.endsWith(".ico"))return"image/x-icon"
if(p.endsWith(".mp3"))return"audio/mpeg"
if(p.endsWith(".wav"))return"audio/wav"
if(p.endsWith(".ogg"))return"audio/ogg"
if(p.endsWith(".flac"))return"audio/flac"
if(p.endsWith(".mp4"))return"video/mp4"
if(p.endsWith(".webm"))return"video/webm"
if(p.endsWith(".ttf"))return"font/ttf"
if(p.endsWith(".otf"))return"font/otf"
if(p.endsWith(".woff"))return"font/woff"
if(p.endsWith(".woff2"))return"font/woff2"
return null
}

function inferContentType(req,url,data){
if(isNavigationRequest(req))return"text/html; charset=utf-8"
switch(req.destination){
case"style":return"text/css; charset=utf-8"
case"script":
case"worker":
case"sharedworker":return"text/javascript; charset=utf-8"
case"manifest":return"application/manifest+json; charset=utf-8"
case"image":
case"font":
case"audio":
case"video":return guessContentTypeByPath(url.pathname)||"application/octet-stream"
}
const byPath=guessContentTypeByPath(url.pathname)
if(byPath)return byPath
if(data&&data.length>0){
try{
const head=new TextDecoder("utf-8").decode(data.slice(0,512)).toLowerCase()
if(head.includes("<!doctype html")||head.includes("<html")||head.includes("<head")||head.includes("<body"))return"text/html; charset=utf-8"
if(head.trimStart().startsWith("{")||head.trimStart().startsWith("["))return"application/json; charset=utf-8"
}catch{}
}
return"application/octet-stream"
}

async function tryDecrypt(ab,pwd){
const blob=new Blob([ab])
const reader=new zip.ZipReader(new zip.BlobReader(blob),{password:pwd})
try{
const entries=await reader.getEntries()
if(!entries||!entries.length)return null
return await entries[0].getData(new zip.Uint8ArrayWriter())
}finally{
await reader.close()
}
}

async function fetchAndMaybeDecrypt(req,url){
log("fetch",url)
const res=await fetch(url,{method:"GET",headers:req.headers,mode:"same-origin",credentials:req.credentials,cache:"no-store",redirect:"follow"})
if(!res||!res.ok)return res

let ab
try{ab=await res.clone().arrayBuffer()}catch{return res}

if(!cachedPasswords||cachedPasswords.length===0){
cachedPasswords=await idbGet(KEY_PWDS)||[]
log("lazy load pwds",cachedPasswords)
}

for(const pwd of cachedPasswords){
try{
const d=await tryDecrypt(ab,pwd)
if(!d)continue
log("decrypt success",url,pwd)
const h=new Headers(res.headers)
h.set("Content-Type",inferContentType(req,new URL(url),d))
h.delete("Content-Disposition")
h.delete("Content-Encoding")
h.delete("Content-Length")
h.set("Cache-Control","no-store")
return new Response(d,{status:200,headers:h})
}catch(e){
log("decrypt fail",url,pwd,e)
}
}

log("no pwd matched",url)
return res
}

self.addEventListener("fetch",e=>{
const req=e.request
const url=new URL(req.url)
if(!shouldHandle(url))return
e.respondWith((async()=>{
if(req.method!=="GET")return fetch(req)
const isNav=isNavigationRequest(req)
if(isNav&&!url.pathname.endsWith("/")&&!hasExtension(url.pathname)){
const r=new URL(url.href)
r.pathname+="/"
log("redirect add slash",url.href,"->",r.href)
return Response.redirect(r.href,302)
}
if(isNav&&url.pathname.endsWith("/")){
const r=new URL(url.href)
r.pathname+="index.html"
log("nav dir -> index",url.href,"->",r.href)
return fetchAndMaybeDecrypt(req,r.href)
}
return fetchAndMaybeDecrypt(req,url.href)
})())
})