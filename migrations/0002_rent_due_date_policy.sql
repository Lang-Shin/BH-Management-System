-- Approved policy: each anniversary rent period is due on its start date.
-- Triggers keep the D1 projection aligned even if a future import bypasses the domain service.

CREATE TRIGGER IF NOT EXISTS rental_periods_due_date_insert_guard
BEFORE INSERT ON rental_periods
FOR EACH ROW
WHEN NEW.due_date <> NEW.start_date
BEGIN
  SELECT RAISE(ABORT, 'rent due date must equal period start date');
END;

CREATE TRIGGER IF NOT EXISTS rental_periods_due_date_update_guard
BEFORE UPDATE OF due_date, start_date ON rental_periods
FOR EACH ROW
WHEN NEW.due_date <> NEW.start_date
BEGIN
  SELECT RAISE(ABORT, 'rent due date must equal period start date');
END;

CREATE TRIGGER IF NOT EXISTS rent_obligations_due_date_insert_guard
BEFORE INSERT ON rent_obligations
FOR EACH ROW
WHEN NEW.due_date <> COALESCE((SELECT start_date FROM rental_periods WHERE id = NEW.rental_period_id), NEW.due_date)
BEGIN
  SELECT RAISE(ABORT, 'rent obligation due date must equal rental period start date');
END;

CREATE TRIGGER IF NOT EXISTS rent_obligations_due_date_update_guard
BEFORE UPDATE OF due_date, rental_period_id ON rent_obligations
FOR EACH ROW
WHEN NEW.due_date <> COALESCE((SELECT start_date FROM rental_periods WHERE id = NEW.rental_period_id), NEW.due_date)
BEGIN
  SELECT RAISE(ABORT, 'rent obligation due date must equal rental period start date');
END;
