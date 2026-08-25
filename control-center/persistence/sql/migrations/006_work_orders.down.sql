DROP VIEW IF EXISTS control_center.v_work_order_projection;
DROP TRIGGER IF EXISTS work_orders_guard_projection ON control_center.work_orders;
DROP TRIGGER IF EXISTS work_orders_no_delete ON control_center.work_orders;
DROP TRIGGER IF EXISTS work_order_event_holds_append_only ON control_center.work_order_event_holds;
DROP TRIGGER IF EXISTS work_order_events_append_only ON control_center.work_order_events;
DROP TABLE IF EXISTS control_center.work_order_event_holds;
DROP TABLE IF EXISTS control_center.work_order_events;
DROP TABLE IF EXISTS control_center.work_orders;
DROP FUNCTION IF EXISTS control_center.cc_guard_work_order_projection();
