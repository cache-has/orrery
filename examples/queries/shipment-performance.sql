SELECT
  c.name as carrier,
  COUNT(*) as shipments,
  ROUND(AVG(EXTRACT(EPOCH FROM (s.delivered_at - s.shipped_at)) / 3600)::numeric, 1) as avg_transit_hours,
  ROUND(
    COUNT(*) FILTER (WHERE s.delivered_at <= s.estimated_delivery)::numeric
    / NULLIF(COUNT(*) FILTER (WHERE s.delivered_at IS NOT NULL), 0) * 100, 1
  ) as on_time_pct,
  COUNT(*) FILTER (WHERE s.status = 'damaged') as damage_claims,
  ROUND(AVG(s.shipping_cost)::numeric, 2) as avg_cost
FROM shipments s
JOIN carriers c ON s.carrier_id = c.carrier_id
WHERE s.shipped_at >= {{date_range.start}}::timestamp AND s.shipped_at <= {{date_range.end}}::timestamp
  AND ({{warehouse}} = 'All' OR s.origin_warehouse = {{warehouse}})
GROUP BY c.name
ORDER BY shipments DESC
