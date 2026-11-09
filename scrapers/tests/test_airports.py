from dutyfree_scrapers.load_airports import parse

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
