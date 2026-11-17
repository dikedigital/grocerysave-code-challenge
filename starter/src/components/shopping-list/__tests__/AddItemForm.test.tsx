import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddItemForm from '../AddItemForm';
import { ITEM_UNITS } from '../../../config/constants';

/** Decision D-140, option A: the form sends `unit` only when the user picked one. */
describe('AddItemForm: the unit', () => {
  it('starts on "auto", followed by every unit of ITEM_UNITS', () => {
    render(<AddItemForm onAdd={jest.fn()} />);
    const select = screen.getByRole('combobox', { name: 'Unit' }) as HTMLSelectElement;
    expect(select.value).toBe('');
    expect([...select.options].map((o) => o.textContent)).toEqual(['auto', ...ITEM_UNITS]);
  });

  it('with "auto" the item is sent without a unit, so the server uses the product unit', async () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(<AddItemForm onAdd={onAdd} />);
    await userEvent.type(screen.getByLabelText('Item'), 'milk');
    await userEvent.click(screen.getByRole('button', { name: /add item/i }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd.mock.calls[0][0]).toEqual({ name: 'milk', quantity: 1, unit: undefined, note: undefined });
    expect('unit' in onAdd.mock.calls[0][0] && onAdd.mock.calls[0][0].unit).toBe(undefined);
    // JSON.stringify drops undefined, so the request body has no unit at all:
    expect(JSON.parse(JSON.stringify(onAdd.mock.calls[0][0]))).toEqual({ name: 'milk', quantity: 1 });
  });

  it('a picked unit is sent, including "each"', async () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(<AddItemForm onAdd={onAdd} />);
    await userEvent.type(screen.getByLabelText('Item'), 'milk');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Unit' }), 'each');
    await userEvent.clear(screen.getByLabelText('Quantity'));
    await userEvent.type(screen.getByLabelText('Quantity'), '2');
    await userEvent.type(screen.getByLabelText('Note (optional)'), ' semi ');
    await userEvent.click(screen.getByRole('button', { name: /add item/i }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd.mock.calls[0][0]).toEqual({ name: 'milk', quantity: 2, unit: 'each', note: 'semi' });
  });

  it('after an item is added the menu goes back to "auto"', async () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(<AddItemForm onAdd={onAdd} />);
    const select = screen.getByRole('combobox', { name: 'Unit' }) as HTMLSelectElement;
    await userEvent.type(screen.getByLabelText('Item'), 'rice');
    await userEvent.selectOptions(select, 'kg');
    await userEvent.click(screen.getByRole('button', { name: /add item/i }));
    await waitFor(() => expect(select.value).toBe(''));
    await userEvent.type(screen.getByLabelText('Item'), 'milk');
    await userEvent.click(screen.getByRole('button', { name: /add item/i }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2));
    expect(onAdd.mock.calls.map((call) => call[0].unit)).toEqual(['kg', undefined]);
  });

  it('when the server refuses, the chosen unit is kept so the user can retry', async () => {
    const onAdd = jest.fn().mockRejectedValue(new Error('quantity: must be greater than 0'));
    render(<AddItemForm onAdd={onAdd} />);
    const select = screen.getByRole('combobox', { name: 'Unit' }) as HTMLSelectElement;
    await userEvent.type(screen.getByLabelText('Item'), 'rice');
    await userEvent.selectOptions(select, 'kg');
    await userEvent.click(screen.getByRole('button', { name: /add item/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('quantity: must be greater than 0');
    expect(select.value).toBe('kg');
  });
});
