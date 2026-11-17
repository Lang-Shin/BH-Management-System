import { useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { Button, Dialog, Flex, Grid, Select, Text, TextField } from '@radix-ui/themes'
import { ROOM_RATE_CATEGORIES } from '@/lib/room-rates'

export function AddRoomDialog() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'form' | 'success'>('form')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [rate, setRate] = useState('RATE_3500')
  const [type, setType] = useState('PRIVATE')
  const [status, setStatus] = useState('available')

  function validate(field: HTMLInputElement) {
    if (!field.value.trim()) return field.id === 'add-room-name' ? 'Enter a room number or name.' : 'Enter a number.'
    if (field.type === 'number' && (!Number.isSafeInteger(field.valueAsNumber) || field.valueAsNumber < Number(field.min))) return field.id === 'add-room-floor' ? 'Enter a whole floor number, 0 or higher.' : 'Enter a whole number of beds, 1 or higher.'
    return ''
  }

  function fieldProps(id: string, helpId: string) {
    return {
      'aria-invalid': Boolean(errors[id]),
      'aria-describedby': `${helpId}${errors[id] ? ` ${id}-error` : ''}`,
      onBlur: (event: React.FocusEvent<HTMLInputElement>) => {
        // Submission validates every field. Avoid moving the button during a pointer click.
        if (event.relatedTarget instanceof HTMLButtonElement && event.relatedTarget.type === 'submit' && event.relatedTarget.form === event.currentTarget.form) return
        const error = validate(event.currentTarget)
        setErrors(previous => ({ ...previous, [id]: error }))
      },
      onChange: () => setErrors(previous => ({ ...previous, [id]: '' })),
    }
  }

  function fieldError(id: string) {
    return errors[id] && <Text as="p" id={`${id}-error`} role="alert" size="2" color="red">{errors[id]}</Text>
  }

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) { setStep('form'); setErrors({}); setRate('RATE_3500'); setType('PRIVATE'); setStatus('available') }
    setOpen(nextOpen)
  }

  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger><Button><Plus size={16} aria-hidden="true" />Add room</Button></Dialog.Trigger>
    <Dialog.Content maxWidth="32rem">
      {step === 'form'
        ? <>
            <Dialog.Title size="5" mb="1">Add a room</Dialog.Title>
            <Dialog.Description size="2" color="gray" mb="4">Enter sample details to preview the form. Nothing will be saved. All fields are required.</Dialog.Description>
            <form noValidate onSubmit={event => {
              event.preventDefault()
              const fields = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>('input'))
              const nextErrors = Object.fromEntries(fields.map(field => [field.id, validate(field)]))
              setErrors(nextErrors)
              const firstInvalid = fields.find(field => nextErrors[field.id])
              if (firstInvalid) firstInvalid.focus()
              else setStep('success')
            }}>
              <Flex direction="column" gap="4">
                <Flex direction="column" gap="1">
                  <Text as="label" htmlFor="add-room-name" size="2" weight="medium">Room number or name</Text>
                  <TextField.Root id="add-room-name" required maxLength={50} placeholder="For example: 107" {...fieldProps('add-room-name', 'add-room-name-help')} />
                  <Text as="p" id="add-room-name-help" size="1" color="gray">Up to 50 characters.</Text>
                  {fieldError('add-room-name')}
                </Flex>
                <Grid columns={{ initial: '1', sm: '2' }} gap="4">
                  <Flex direction="column" gap="1">
                    <Text as="label" htmlFor="add-room-floor" size="2" weight="medium">Floor</Text>
                    <TextField.Root id="add-room-floor" type="number" required min={0} step={1} defaultValue={1} {...fieldProps('add-room-floor', 'add-room-floor-help')} />
                    <Text as="p" id="add-room-floor-help" size="1" color="gray">Whole numbers, 0 or higher.</Text>
                    {fieldError('add-room-floor')}
                  </Flex>
                  <Flex direction="column" gap="1">
                    <Text as="label" htmlFor="add-room-beds" size="2" weight="medium">Number of beds</Text>
                    <TextField.Root id="add-room-beds" type="number" required min={1} step={1} defaultValue={1} {...fieldProps('add-room-beds', 'add-room-beds-help')} />
                    {fieldError('add-room-beds')}
                  </Flex>
                </Grid>
                <Text as="p" id="add-room-beds-help" size="1" color="gray" style={{ marginTop: -8 }}>Enter a whole number, 1 or higher. Bed counts are for reference only and do not determine room availability.</Text>
                <Flex direction="column" gap="1">
                  <Text as="label" htmlFor="add-room-rate" size="2" weight="medium">Monthly rental rate</Text>
                  <Select.Root value={rate} onValueChange={setRate}>
                    <Select.Trigger id="add-room-rate" style={{ width: '100%' }} />
                    <Select.Content>{ROOM_RATE_CATEGORIES.map(category => <Select.Item key={category.id} value={category.id}>{category.label}/month</Select.Item>)}</Select.Content>
                  </Select.Root>
                </Flex>
                <Grid columns={{ initial: '1', sm: '2' }} gap="4">
                  <Flex direction="column" gap="1">
                    <Text as="label" htmlFor="add-room-type" size="2" weight="medium">Room type</Text>
                    <Select.Root value={type} onValueChange={setType}>
                      <Select.Trigger id="add-room-type" style={{ width: '100%' }} />
                      <Select.Content><Select.Item value="PRIVATE">Private</Select.Item><Select.Item value="SHARED">Shared</Select.Item></Select.Content>
                    </Select.Root>
                  </Flex>
                  <Flex direction="column" gap="1">
                    <Text as="label" htmlFor="add-room-status" size="2" weight="medium">Room status</Text>
                    <Select.Root value={status} onValueChange={setStatus}>
                      <Select.Trigger id="add-room-status" style={{ width: '100%' }} />
                      <Select.Content><Select.Item value="available">Available</Select.Item><Select.Item value="maintenance">Under repair</Select.Item></Select.Content>
                    </Select.Root>
                  </Flex>
                </Grid>
              </Flex>
              <Flex gap="3" mt="5" justify="end">
                <Dialog.Close><Button type="button" variant="soft" color="gray">Cancel</Button></Dialog.Close>
                <Button type="submit">Preview room</Button>
              </Flex>
            </form>
          </>
        : <>
            <Dialog.Title size="5" mb="2"><Check size={20} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 8, color: 'var(--accent-11)' }} />Room preview complete</Dialog.Title>
            <Dialog.Description size="3" role="status">Your sample details passed the form checks. No new room was saved to the list.</Dialog.Description>
            <Flex mt="5" justify="end"><Button autoFocus onClick={() => changeOpen(false)}>Got it</Button></Flex>
          </>}
    </Dialog.Content>
  </Dialog.Root>
}
