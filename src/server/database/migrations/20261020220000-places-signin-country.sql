-- UP
-- XENO Places: a real location source for owners who never set Language & region.
-- At sign-in we keep the COUNTRY Cloudflare already derived (CF-IPCountry) in the owner's own settings record,
-- at settings.workspace.region = { region: 'DE', source: 'signin_country' }. No IP is stored for this.
-- A value the person set (no source marker) is never overwritten; the person saving Language & region replaces it.
-- Precedence: person-set country > time zone > sign-in country > default city.
ALTER TABLE places DROP CONSTRAINT IF EXISTS places_location_source_check;
ALTER TABLE places ADD CONSTRAINT places_location_source_check
  CHECK (location_source IN ('owner_region','owner_timezone','signin_country','relocated','default'));

CREATE OR REPLACE FUNCTION places_region_of_country(cc TEXT, tz TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN cc IN ('US') AND tz ~ '^America/(Los_Angeles|Vancouver|Phoenix|Denver|Boise|Anchorage)' THEN 'na-west'
    WHEN cc IN ('US') THEN 'na-east'
    WHEN cc IN ('CA') THEN 'na-north'
    WHEN cc IN ('BR','AR','CL','UY','PY') THEN 'sa-south'
    WHEN cc IN ('SE','NO','DK','FI','IS') THEN 'eu-north'
    WHEN cc IN ('DE','AT','CH','PL','CZ','SK','HU','RO','BG','SI','HR','RS','UA','LT','LV','EE','MD') THEN 'eu-central'
    WHEN cc IN ('GB','IE','FR','ES','PT','IT','NL','BE','LU','MT','GR','CY') THEN 'eu-west'
    WHEN cc IN ('AE','SA','QA','KW','BH','OM') THEN 'af-gulf'
    WHEN cc IN ('NG','GH','SN','CI') THEN 'af-west'
    WHEN cc IN ('JP','KR','TW') THEN 'as-east'
    WHEN cc IN ('IN','PK','BD','LK','NP') THEN 'as-south'
    WHEN cc IN ('SG','MY','TH','ID','PH','VN') THEN 'as-se'
    WHEN cc IN ('AU','NZ') THEN 'oc-aus'
  END $$;

CREATE OR REPLACE FUNCTION places_region_of_tz(tz TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN tz ~ '^America/(Los_Angeles|Vancouver|Tijuana|Phoenix|Denver|Boise|Anchorage)' THEN 'na-west'
    WHEN tz ~ '^America/(Toronto|Montreal|Winnipeg|Edmonton|Halifax|Regina)' THEN 'na-north'
    WHEN tz ~ '^America/(New_York|Chicago|Detroit|Indiana|Kentucky)' THEN 'na-east'
    WHEN tz ~ '^America/(Sao_Paulo|Argentina|Buenos_Aires|Santiago|Montevideo|Asuncion)' THEN 'sa-south'
    WHEN tz ~ '^Europe/(Stockholm|Oslo|Copenhagen|Helsinki)|^Atlantic/Reykjavik' THEN 'eu-north'
    WHEN tz ~ '^Europe/(Berlin|Vienna|Zurich|Warsaw|Prague|Bratislava|Budapest|Bucharest|Sofia|Ljubljana|Zagreb|Belgrade|Kyiv|Kiev|Vilnius|Riga|Tallinn|Chisinau)' THEN 'eu-central'
    WHEN tz ~ '^Europe/' THEN 'eu-west'
    WHEN tz ~ '^Asia/(Dubai|Riyadh|Qatar|Kuwait|Bahrain|Muscat)' THEN 'af-gulf'
    WHEN tz ~ '^Africa/(Lagos|Accra|Dakar|Abidjan)' THEN 'af-west'
    WHEN tz ~ '^Asia/(Tokyo|Seoul|Taipei)' THEN 'as-east'
    WHEN tz ~ '^Asia/(Kolkata|Calcutta|Karachi|Dhaka|Colombo|Kathmandu)' THEN 'as-south'
    WHEN tz ~ '^Asia/(Singapore|Kuala_Lumpur|Bangkok|Jakarta|Manila|Ho_Chi_Minh)' THEN 'as-se'
    WHEN tz ~ '^(Australia/|Pacific/Auckland)' THEN 'oc-aus'
  END $$;

-- The XENO city for a region (polis/geo.js CITIES), and back. NULL for anything unknown.
CREATE OR REPLACE FUNCTION places_city_of_region(r TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE r
    WHEN 'eu-west' THEN 'meridian' WHEN 'na-west' THEN 'halcyon' WHEN 'eu-central' THEN 'lindgren'
    WHEN 'na-east' THEN 'harbor' WHEN 'eu-north' THEN 'nordhavn' WHEN 'as-east' THEN 'sakura'
    WHEN 'as-se' THEN 'lumen' WHEN 'as-south' THEN 'vega' WHEN 'sa-south' THEN 'solace'
    WHEN 'af-west' THEN 'atlas' WHEN 'af-gulf' THEN 'aurum' WHEN 'oc-aus' THEN 'southgate'
    WHEN 'na-north' THEN 'aurora' END $$;
CREATE OR REPLACE FUNCTION places_region_of_city(c TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT r FROM unnest(ARRAY['eu-west','na-west','eu-central','na-east','eu-north','as-east','as-se','as-south','sa-south','af-west','af-gulf','oc-aus','na-north']) r
  WHERE places_city_of_region(r) = c $$;

CREATE OR REPLACE FUNCTION places_home_city(p_owner UUID, OUT city_id TEXT, OUT region_id TEXT, OUT source TEXT)
LANGUAGE plpgsql STABLE AS $$
DECLARE cc TEXT; tz TEXT; src TEXT;
BEGIN
  SELECT upper(s.settings #>> '{workspace,region,region}'), s.settings #>> '{workspace,region,tz}', s.settings #>> '{workspace,region,source}'
    INTO cc, tz, src FROM user_settings s WHERE s.user_id = p_owner LIMIT 1;
  IF src IS DISTINCT FROM 'signin_country' THEN
    region_id := places_region_of_country(cc, tz); source := 'owner_region';
  END IF;
  IF region_id IS NULL THEN region_id := places_region_of_tz(tz); source := 'owner_timezone'; END IF;
  IF region_id IS NULL AND src = 'signin_country' THEN region_id := places_region_of_country(cc, tz); source := 'signin_country'; END IF;
  IF region_id IS NULL THEN region_id := 'eu-west'; source := 'default'; END IF;
  city_id := places_city_of_region(region_id);
END $$;

-- DOWN
UPDATE places SET location_source = 'default' WHERE location_source IN ('signin_country','relocated');
ALTER TABLE places DROP CONSTRAINT IF EXISTS places_location_source_check;
ALTER TABLE places ADD CONSTRAINT places_location_source_check CHECK (location_source IN ('owner_region','owner_timezone','default'));
CREATE OR REPLACE FUNCTION places_home_city(p_owner UUID, OUT city_id TEXT, OUT region_id TEXT, OUT source TEXT)
LANGUAGE plpgsql STABLE AS $$
DECLARE cc TEXT; tz TEXT;
BEGIN
  SELECT upper(s.settings #>> '{workspace,region,region}'), s.settings #>> '{workspace,region,tz}'
    INTO cc, tz FROM user_settings s WHERE s.user_id = p_owner LIMIT 1;
  region_id := places_region_of_country(cc, tz);
  IF region_id IS NOT NULL THEN source := 'owner_region';
  ELSE region_id := places_region_of_tz(tz);
    source := CASE WHEN region_id IS NOT NULL THEN 'owner_timezone' ELSE 'default' END;
    region_id := COALESCE(region_id, 'eu-west');
  END IF;
  city_id := places_city_of_region(region_id);
END $$;
DROP FUNCTION IF EXISTS places_region_of_city(TEXT);
