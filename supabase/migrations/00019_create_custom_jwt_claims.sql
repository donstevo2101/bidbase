-- =============================================================
-- Custom JWT claims function
-- Injects org_id and user_role into the JWT so RLS policies
-- can read them via auth.jwt() ->> 'org_id' / 'user_role'
-- =============================================================

CREATE OR REPLACE FUNCTION auth.custom_access_token_hook(event jsonb)
RETURNS jsonb AS $$
DECLARE
  claims jsonb;
  user_org_id uuid;
  user_role text;
BEGIN
  -- Fetch the user's org_id and role from profiles
  SELECT p.organisation_id, p.role
  INTO user_org_id, user_role
  FROM public.profiles p
  WHERE p.id = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';

  IF user_org_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{org_id}', to_jsonb(user_org_id::text));
  END IF;

  IF user_role IS NOT NULL THEN
    claims := jsonb_set(claims, '{user_role}', to_jsonb(user_role));
  END IF;

  -- Update the event with modified claims
  event := jsonb_set(event, '{claims}', claims);

  RETURN event;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Grant execute to supabase_auth_admin so Auth can call this hook
GRANT EXECUTE ON FUNCTION auth.custom_access_token_hook TO supabase_auth_admin;

-- Revoke from public
REVOKE EXECUTE ON FUNCTION auth.custom_access_token_hook FROM public;
REVOKE EXECUTE ON FUNCTION auth.custom_access_token_hook FROM anon;
REVOKE EXECUTE ON FUNCTION auth.custom_access_token_hook FROM authenticated;
