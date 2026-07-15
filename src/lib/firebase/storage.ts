import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { getFirebaseStorageInstance } from './config'

const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.82

async function compressImage(file: File): Promise<Blob> {
  // Non-image or already small files: pass through
  if (!file.type.startsWith('image/')) return file
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file

  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return file

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const targetWidth = Math.round(bitmap.width * scale)
  const targetHeight = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
  bitmap.close?.()

  const blob = await new Promise<Blob | null>(resolve => {
    canvas.toBlob(b => resolve(b), 'image/jpeg', JPEG_QUALITY)
  })
  if (!blob) return file
  // If compression yielded a larger file, return the original
  return blob.size < file.size ? blob : file
}

export async function uploadProductImage(file: File, productKey: string): Promise<string> {
  const storage = getFirebaseStorageInstance()
  const compressed = await compressImage(file)
  const safeKey = productKey || 'unsorted'
  const path = `products/${safeKey}/${Date.now()}.jpg`
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, compressed, {
    contentType: 'image/jpeg',
    cacheControl: 'public, max-age=31536000, immutable',
  })
  return getDownloadURL(storageRef)
}

export async function uploadSupplierAttachment(file: File, supplierKey: string): Promise<string> {
  const storage = getFirebaseStorageInstance()
  const safeKey = supplierKey || 'unsorted'
  const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf'
  const path = `suppliers/${safeKey}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, file, {
    contentType: file.type || 'application/pdf',
    cacheControl: 'public, max-age=31536000, immutable',
  })
  return getDownloadURL(storageRef)
}

export async function uploadPurchaseOrderInvoice(file: File, orderKey: string): Promise<string> {
  const storage = getFirebaseStorageInstance()
  const safeKey = orderKey || 'unsorted'
  const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf'
  const path = `purchase-orders/${safeKey}/invoice-${Date.now()}.${ext}`
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, file, {
    contentType: file.type || 'application/pdf',
    cacheControl: 'public, max-age=31536000, immutable',
  })
  return getDownloadURL(storageRef)
}

export async function uploadPurchaseInvoiceFile(file: File, invoiceKey: string): Promise<string> {
  const storage = getFirebaseStorageInstance()
  const safeKey = invoiceKey || 'unsorted'
  const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf'
  const path = `purchase-invoices/${safeKey}/invoice-${Date.now()}.${ext}`
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, file, {
    contentType: file.type || 'application/pdf',
    cacheControl: 'public, max-age=31536000, immutable',
  })
  return getDownloadURL(storageRef)
}

export async function uploadShippingSlip(file: File, saleKey: string): Promise<string> {
  const storage = getFirebaseStorageInstance()
  const safeKey = saleKey || 'unsorted'
  const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf'
  const path = `shipping-slips/${safeKey}/slip-${Date.now()}.${ext}`
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, file, {
    contentType: file.type || 'application/pdf',
    cacheControl: 'public, max-age=31536000, immutable',
  })
  return getDownloadURL(storageRef)
}

export async function uploadSaleDocumentPdf(blob: Blob, saleKey: string, fileName: string): Promise<string> {
  const storage = getFirebaseStorageInstance()
  const safeKey = saleKey || 'unsorted'
  const path = `sale-documents/${safeKey}/${Date.now()}-${fileName}`
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, blob, {
    contentType: 'application/pdf',
    cacheControl: 'public, max-age=31536000, immutable',
  })
  return getDownloadURL(storageRef)
}

/** Resource Center のサムネイル。非会員にもぼかして見せるティザー用なので、
 *  他の画像と同じく公開URL(getDownloadURL)で問題ない。 */
export async function uploadResourceThumbnail(file: File, resourceKey: string): Promise<string> {
  const storage = getFirebaseStorageInstance()
  const compressed = await compressImage(file)
  const safeKey = resourceKey || 'unsorted'
  const path = `resources/${safeKey}/thumb-${Date.now()}.jpg`
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, compressed, {
    contentType: 'image/jpeg',
    cacheControl: 'public, max-age=31536000, immutable',
  })
  return getDownloadURL(storageRef)
}

/** Resource Center の保護素材（農園の写真・動画の原本）。
 *
 *  IMPORTANT: ここでは getDownloadURL() を呼ばない。呼ぶとトークン付きの
 *  実質公開URLが発行され、URL を知る誰でも落とせてしまい会員限定が崩れる。
 *  代わりに storagePath を返して Firestore に保存し、配信は sabo-wholesale の
 *  /api/wholesale/resources/[id]/download が会員確認後に署名付きURLで行う。
 *  （圧縮もしない — 素材は原寸のまま配る） */
export async function uploadResourceAsset(file: File, resourceKey: string): Promise<{
  storagePath: string
  fileName: string
  contentType: string
  sizeBytes: number
}> {
  const storage = getFirebaseStorageInstance()
  const safeKey = resourceKey || 'unsorted'
  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
  const storagePath = `resources/${safeKey}/asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const storageRef = ref(storage, storagePath)
  await uploadBytes(storageRef, file, {
    contentType: file.type || 'application/octet-stream',
    cacheControl: 'private, max-age=0, no-store',
  })
  return {
    storagePath,
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
  }
}

export async function deleteStorageObjectByUrl(url: string): Promise<void> {
  if (!url) return
  try {
    const storage = getFirebaseStorageInstance()
    const storageRef = ref(storage, url)
    await deleteObject(storageRef)
  } catch {
    // ignore
  }
}

export async function deleteProductImageByUrl(url: string): Promise<void> {
  if (!url) return
  try {
    const storage = getFirebaseStorageInstance()
    const storageRef = ref(storage, url)
    await deleteObject(storageRef)
  } catch {
    // ignore errors (object may not exist or url isn't a storage url)
  }
}
