import { useModifiers, useProducts, useProductSizes } from '@/features/setup/data'

/** "Large Latte" and "Large Latte + Oat milk", from ids. */
export function useDrinkLabel() {
  const products = useProducts()
  const sizes = useProductSizes()
  const modifiers = useModifiers()
  const size = (sizeId: string | null) => {
    const sz = sizes.data?.find((x) => x.id === sizeId)
    const product = products.data?.find((x) => x.id === sz?.product_id)
    if (!sz || !product) return ''
    // A product with one size reads better without it ("Hot dog", not "Regular Hot dog").
    const only = (sizes.data ?? []).filter((x) => x.product_id === product.id).length === 1
    return only ? product.name : `${sz.name} ${product.name}`
  }
  const mods = (ids: string[] | null | undefined) =>
    (ids ?? []).map((id) => modifiers.data?.find((m) => m.id === id)?.name).filter(Boolean).join(', ')
  return {
    size,
    mods,
    label: (sizeId: string | null, modIds?: string[] | null) => {
      const m = mods(modIds)
      return m ? `${size(sizeId)} + ${m}` : size(sizeId)
    },
  }
}
