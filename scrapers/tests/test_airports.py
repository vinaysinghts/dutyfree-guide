from dutyfree_scrapers.load_airports import parse, to_bundle

CSV = """id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,continent,iso_country,iso_region,municipality,scheduled_service,icao_code,iata_code,gps_code,local_code,home_link,wikipedia_link,keywords
1,EHAM,large_airport,Amsterdam Airport Schiphol,52.3086,4.7639,-11,EU,NL,NL-NH,Amsterdam,yes,EHAM,AMS,EHAM,,,,
2,VOBL,large_airport,Kempegowda International Airport,13.1979,77.7063,3000,AS,IN,IN-KA,Bengaluru,yes,VOBL,BLR,VOBL,,,,
3,XXXX,small_airport,Tiny Strip,0,0,0,EU,NL,NL-NH,Nowhere,no,,TNY,,,,,
4,YYYY,heliport,Heli,0,0,0,EU,NL,NL-NH,Nowhere,yes,,HLI,,,,,
"""


def test_parse_keeps_scheduled_airports_only():
    rows = parse(CSV)
    assert sorted(r["iata"] for r in rows) == ["AMS", "BLR"]
    blr = next(r for r in rows if r["iata"] == "BLR")
    assert blr["city"] == "Bengaluru" and blr["country_code"] == "IN"


CSV_ALIASES = CSV.splitlines()[0] + "\n" + (
    '5,LFSB,large_airport,EuroAirport Basel–Mulhouse–Freiburg,47.6,7.52,885,EU,FR,FR-GES,'
    '"Bâle / Mulhouse",yes,LFSB,BSL,LFSB,,,,"MLH, EAP, LSZM, Bâle, Basle"\n'
)


def test_parse_keeps_icao_and_alternate_names():
    (bsl,) = parse(CSV_ALIASES)
    assert bsl["icao"] == "LFSB"
    assert "MLH" in bsl["keywords"] and "Basle" in bsl["keywords"]
    assert bsl["size"] == "L"


def test_bundle_rows_are_compact_and_sorted():
    rows = to_bundle(parse(CSV + CSV_ALIASES.split("\n", 1)[1]))
    assert [r[0] for r in rows] == ["AMS", "BLR", "BSL"]
    assert rows[2] == ["BSL", "LFSB", "EuroAirport Basel–Mulhouse–Freiburg", "Bâle / Mulhouse", "FR",
                       47.6, 7.52, "MLH, EAP, LSZM, Bâle, Basle", "L"]
