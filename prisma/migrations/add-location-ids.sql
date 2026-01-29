-- Migration: Add locationId to all tables for multi-tenancy
-- This script adds locationId columns and populates them from parent records

-- Get the default location ID (we have one location in dev)
-- We'll use the first location from the Location table

-- ==================================================
-- STEP 1: Add locationId columns (nullable first)
-- ==================================================

-- Modifier (gets locationId from ModifierGroup)
ALTER TABLE Modifier ADD COLUMN locationId TEXT;

-- MenuItemModifierGroup (gets locationId from MenuItem)
ALTER TABLE MenuItemModifierGroup ADD COLUMN locationId TEXT;

-- ComboTemplate (gets locationId from MenuItem via menuItemId)
ALTER TABLE ComboTemplate ADD COLUMN locationId TEXT;

-- ComboComponent (gets locationId from ComboTemplate)
ALTER TABLE ComboComponent ADD COLUMN locationId TEXT;

-- ComboComponentOption (gets locationId from ComboComponent)
ALTER TABLE ComboComponentOption ADD COLUMN locationId TEXT;

-- SectionAssignment (gets locationId from Section)
ALTER TABLE SectionAssignment ADD COLUMN locationId TEXT;

-- OrderItem (gets locationId from Order)
ALTER TABLE OrderItem ADD COLUMN locationId TEXT;

-- OrderItemModifier (gets locationId from OrderItem)
ALTER TABLE OrderItemModifier ADD COLUMN locationId TEXT;

-- Payment (gets locationId from Order)
ALTER TABLE Payment ADD COLUMN locationId TEXT;

-- CouponRedemption (gets locationId from Coupon)
ALTER TABLE CouponRedemption ADD COLUMN locationId TEXT;

-- OrderDiscount (gets locationId from Order)
ALTER TABLE OrderDiscount ADD COLUMN locationId TEXT;

-- UpsellEvent (gets locationId from UpsellConfig)
ALTER TABLE UpsellEvent ADD COLUMN locationId TEXT;

-- VoidLog (gets locationId from Order)
ALTER TABLE VoidLog ADD COLUMN locationId TEXT;

-- TipPoolEntry (gets locationId from TipPool)
ALTER TABLE TipPoolEntry ADD COLUMN locationId TEXT;

-- GiftCardTransaction (gets locationId from GiftCard)
ALTER TABLE GiftCardTransaction ADD COLUMN locationId TEXT;

-- HouseAccountTransaction (gets locationId from HouseAccount)
ALTER TABLE HouseAccountTransaction ADD COLUMN locationId TEXT;

-- EventPricingTier (gets locationId from Event)
ALTER TABLE EventPricingTier ADD COLUMN locationId TEXT;

-- EventTableConfig (gets locationId from Event)
ALTER TABLE EventTableConfig ADD COLUMN locationId TEXT;

-- Break (gets locationId from TimeClockEntry)
ALTER TABLE Break ADD COLUMN locationId TEXT;

-- RecipeIngredient (gets locationId from MenuItem)
ALTER TABLE RecipeIngredient ADD COLUMN locationId TEXT;

-- SpiritModifierGroup (gets locationId from ModifierGroup)
ALTER TABLE SpiritModifierGroup ADD COLUMN locationId TEXT;

-- PaidInOut (gets locationId from Drawer)
ALTER TABLE PaidInOut ADD COLUMN locationId TEXT;

-- ==================================================
-- STEP 2: Populate locationId from parent records
-- ==================================================

-- Modifier: Get locationId from ModifierGroup
UPDATE Modifier
SET locationId = (SELECT locationId FROM ModifierGroup WHERE ModifierGroup.id = Modifier.modifierGroupId);

-- MenuItemModifierGroup: Get locationId from MenuItem
UPDATE MenuItemModifierGroup
SET locationId = (SELECT locationId FROM MenuItem WHERE MenuItem.id = MenuItemModifierGroup.menuItemId);

-- ComboTemplate: Get locationId from MenuItem
UPDATE ComboTemplate
SET locationId = (SELECT locationId FROM MenuItem WHERE MenuItem.id = ComboTemplate.menuItemId);

-- ComboComponent: Get locationId from ComboTemplate
UPDATE ComboComponent
SET locationId = (SELECT locationId FROM ComboTemplate WHERE ComboTemplate.id = ComboComponent.comboTemplateId);

-- ComboComponentOption: Get locationId from ComboComponent
UPDATE ComboComponentOption
SET locationId = (SELECT locationId FROM ComboComponent WHERE ComboComponent.id = ComboComponentOption.comboComponentId);

-- SectionAssignment: Get locationId from Section
UPDATE SectionAssignment
SET locationId = (SELECT locationId FROM Section WHERE Section.id = SectionAssignment.sectionId);

-- OrderItem: Get locationId from Order
UPDATE OrderItem
SET locationId = (SELECT locationId FROM "Order" WHERE "Order".id = OrderItem.orderId);

-- OrderItemModifier: Get locationId from OrderItem
UPDATE OrderItemModifier
SET locationId = (SELECT locationId FROM OrderItem WHERE OrderItem.id = OrderItemModifier.orderItemId);

-- Payment: Get locationId from Order
UPDATE Payment
SET locationId = (SELECT locationId FROM "Order" WHERE "Order".id = Payment.orderId);

-- CouponRedemption: Get locationId from Coupon
UPDATE CouponRedemption
SET locationId = (SELECT locationId FROM Coupon WHERE Coupon.id = CouponRedemption.couponId);

-- OrderDiscount: Get locationId from Order
UPDATE OrderDiscount
SET locationId = (SELECT locationId FROM "Order" WHERE "Order".id = OrderDiscount.orderId);

-- UpsellEvent: Get locationId from UpsellConfig
UPDATE UpsellEvent
SET locationId = (SELECT locationId FROM UpsellConfig WHERE UpsellConfig.id = UpsellEvent.upsellConfigId);

-- VoidLog: Get locationId from Order
UPDATE VoidLog
SET locationId = (SELECT locationId FROM "Order" WHERE "Order".id = VoidLog.orderId);

-- TipPoolEntry: Get locationId from TipPool
UPDATE TipPoolEntry
SET locationId = (SELECT locationId FROM TipPool WHERE TipPool.id = TipPoolEntry.tipPoolId);

-- GiftCardTransaction: Get locationId from GiftCard
UPDATE GiftCardTransaction
SET locationId = (SELECT locationId FROM GiftCard WHERE GiftCard.id = GiftCardTransaction.giftCardId);

-- HouseAccountTransaction: Get locationId from HouseAccount
UPDATE HouseAccountTransaction
SET locationId = (SELECT locationId FROM HouseAccount WHERE HouseAccount.id = HouseAccountTransaction.houseAccountId);

-- EventPricingTier: Get locationId from Event
UPDATE EventPricingTier
SET locationId = (SELECT locationId FROM Event WHERE Event.id = EventPricingTier.eventId);

-- EventTableConfig: Get locationId from Event
UPDATE EventTableConfig
SET locationId = (SELECT locationId FROM Event WHERE Event.id = EventTableConfig.eventId);

-- Break: Get locationId from TimeClockEntry
UPDATE Break
SET locationId = (SELECT locationId FROM TimeClockEntry WHERE TimeClockEntry.id = Break.timeClockEntryId);

-- RecipeIngredient: Get locationId from MenuItem
UPDATE RecipeIngredient
SET locationId = (SELECT locationId FROM MenuItem WHERE MenuItem.id = RecipeIngredient.menuItemId);

-- SpiritModifierGroup: Get locationId from ModifierGroup
UPDATE SpiritModifierGroup
SET locationId = (SELECT locationId FROM ModifierGroup WHERE ModifierGroup.id = SpiritModifierGroup.modifierGroupId);

-- PaidInOut: Get locationId from Drawer
UPDATE PaidInOut
SET locationId = (SELECT locationId FROM Drawer WHERE Drawer.id = PaidInOut.drawerId);

-- ==================================================
-- STEP 3: Add indexes for locationId columns
-- ==================================================

CREATE INDEX IF NOT EXISTS idx_Modifier_locationId ON Modifier(locationId);
CREATE INDEX IF NOT EXISTS idx_MenuItemModifierGroup_locationId ON MenuItemModifierGroup(locationId);
CREATE INDEX IF NOT EXISTS idx_ComboTemplate_locationId ON ComboTemplate(locationId);
CREATE INDEX IF NOT EXISTS idx_ComboComponent_locationId ON ComboComponent(locationId);
CREATE INDEX IF NOT EXISTS idx_ComboComponentOption_locationId ON ComboComponentOption(locationId);
CREATE INDEX IF NOT EXISTS idx_SectionAssignment_locationId ON SectionAssignment(locationId);
CREATE INDEX IF NOT EXISTS idx_OrderItem_locationId ON OrderItem(locationId);
CREATE INDEX IF NOT EXISTS idx_OrderItemModifier_locationId ON OrderItemModifier(locationId);
CREATE INDEX IF NOT EXISTS idx_Payment_locationId ON Payment(locationId);
CREATE INDEX IF NOT EXISTS idx_CouponRedemption_locationId ON CouponRedemption(locationId);
CREATE INDEX IF NOT EXISTS idx_OrderDiscount_locationId ON OrderDiscount(locationId);
CREATE INDEX IF NOT EXISTS idx_UpsellEvent_locationId ON UpsellEvent(locationId);
CREATE INDEX IF NOT EXISTS idx_VoidLog_locationId ON VoidLog(locationId);
CREATE INDEX IF NOT EXISTS idx_TipPoolEntry_locationId ON TipPoolEntry(locationId);
CREATE INDEX IF NOT EXISTS idx_GiftCardTransaction_locationId ON GiftCardTransaction(locationId);
CREATE INDEX IF NOT EXISTS idx_HouseAccountTransaction_locationId ON HouseAccountTransaction(locationId);
CREATE INDEX IF NOT EXISTS idx_EventPricingTier_locationId ON EventPricingTier(locationId);
CREATE INDEX IF NOT EXISTS idx_EventTableConfig_locationId ON EventTableConfig(locationId);
CREATE INDEX IF NOT EXISTS idx_Break_locationId ON Break(locationId);
CREATE INDEX IF NOT EXISTS idx_RecipeIngredient_locationId ON RecipeIngredient(locationId);
CREATE INDEX IF NOT EXISTS idx_SpiritModifierGroup_locationId ON SpiritModifierGroup(locationId);
CREATE INDEX IF NOT EXISTS idx_PaidInOut_locationId ON PaidInOut(locationId);

-- Done!
