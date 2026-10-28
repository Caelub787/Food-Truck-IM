import { useEffect, useState, type ComponentProps } from 'react'
import { Button } from './ui'

/** A button that needs two taps, so nothing serious happens by accident. */
export function ConfirmButton({
  confirmLabel,
  onConfirm,
  children,
  ...rest
}: Omit<ComponentProps<typeof Button>, 'onClick'> & { confirmLabel: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(timer)
  }, [armed])

  return (
    <Button
      {...rest}
      onClick={() => {
        if (armed) {
          setArmed(false)
          onConfirm()
        } else setArmed(true)
      }}
    >
      {armed ? confirmLabel : children}
    </Button>
  )
}
