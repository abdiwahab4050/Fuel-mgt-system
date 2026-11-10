-- CreateIndex
CREATE INDEX "FuelDelivery_status_deliveryDate_idx" ON "FuelDelivery"("status", "deliveryDate");

-- CreateIndex
CREATE INDEX "Invoice_status_dueDate_idx" ON "Invoice"("status", "dueDate");

-- CreateIndex
CREATE INDEX "Payment_verifiedAt_idx" ON "Payment"("verifiedAt");

-- CreateIndex
CREATE INDEX "Refund_decidedAt_idx" ON "Refund"("decidedAt");

-- CreateIndex
CREATE INDEX "FuelConsumption_date_idx" ON "FuelConsumption"("date");

-- CreateIndex
CREATE INDEX "Expense_status_expenseDate_idx" ON "Expense"("status", "expenseDate");


-- -------------------------------------------------------------
-- Integrity backstops enforced by the database itself.
-- The application already enforces these rules; the constraints make sure a
-- bug, a manual SQL edit or a future code change cannot break them silently.
-- (Prisma does not model CHECK constraints or triggers; it leaves them alone.)
-- -------------------------------------------------------------

ALTER TABLE "Tank" ADD CONSTRAINT "Tank_level_within_capacity"
  CHECK ("currentLiters" >= 0 AND "currentLiters" <= "capacityLiters" AND "minLevelLiters" >= 0);

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_amounts_valid"
  CHECK ("total" >= 0 AND "amountPaid" >= 0 AND "amountPaid" <= "total");

ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_amounts_valid"
  CHECK ("amount" > 0 AND "amountPaid" >= 0 AND "amountPaid" <= "amount");

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_quantity_positive" CHECK ("quantity" > 0 AND "unitPrice" > 0 AND "lineTotal" >= 0);
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_total_positive" CHECK ("total" > 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_quantity_nonzero" CHECK ("quantity" <> 0 AND "balanceAfter" >= 0);
ALTER TABLE "FuelDelivery" ADD CONSTRAINT "FuelDelivery_quantity_positive" CHECK ("quantityDelivered" > 0 AND "unitCost" > 0);

-- Append-only ledgers: rows can be added, never edited.
-- (Restrict DELETE on these tables through database role permissions in production; see DEPLOYMENT notes.)
CREATE OR REPLACE FUNCTION fuelflow_reject_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only and cannot be modified', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fuelflow_reject_update();
CREATE TRIGGER "StockMovement_append_only" BEFORE UPDATE ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION fuelflow_reject_update();
CREATE TRIGGER "PaymentTransaction_append_only" BEFORE UPDATE ON "PaymentTransaction" FOR EACH ROW EXECUTE FUNCTION fuelflow_reject_update();
