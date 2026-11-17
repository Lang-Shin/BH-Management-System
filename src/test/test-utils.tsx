import type { ReactElement } from 'react'
import { render, screen, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'

/** Radix Themes portals (dialogs, selects) need a <Theme> ancestor. */
export function renderWithTheme(ui: ReactElement) {
  return render(<Theme accentColor="green" grayColor="sand">{ui}</Theme>)
}

/** Open a Radix Select by its accessible label and choose an option by its visible name. */
export async function chooseOption(user: UserEvent, select: HTMLElement, optionName: string | RegExp) {
  await user.click(select)
  await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: optionName }))
}
