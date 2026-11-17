import { useState } from 'react'
import { AlertDialog, Button, Flex, Text } from '@radix-ui/themes'
import { RotateCcw } from 'lucide-react'
import { usePrototype } from '@/hooks/use-prototype'
import { clearReadIds } from '@/features/notifications/read-state'

export function ResetDemoButton() {
  const { dispatch } = usePrototype()
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState('')
  return <>
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      <AlertDialog.Trigger><Button variant="outline" color="gray"><RotateCcw size={16} />Restore sample records</Button></AlertDialog.Trigger>
      <AlertDialog.Content maxWidth="30rem">
        <AlertDialog.Title>Restore the sample records?</AlertDialog.Title>
        <AlertDialog.Description size="2">This replaces all sample records, including your notes, room changes, recorded payments, receipts, meter readings, and notification read status. This cannot be undone.</AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel><Button variant="soft" color="gray">Keep my changes</Button></AlertDialog.Cancel>
          <AlertDialog.Action><Button color="red" onClick={() => { clearReadIds(); dispatch({ type: 'demo/reset' }); setOpen(false); setNotice('The original sample records have been restored.') }}>Yes, restore records</Button></AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
    <Text as="p" role="status" size="2" color="green" mt="3">{notice}</Text>
  </>
}
