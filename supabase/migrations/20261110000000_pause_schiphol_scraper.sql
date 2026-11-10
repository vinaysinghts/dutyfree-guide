-- Stop the daily scrape from requesting schiphol.nl: every automated request
-- gets a Cloudflare bot challenge (403, cf-mitigated: challenge), and bypassing
-- it would break our scraping policy (ADR-0004, problems log #9). AMS prices
-- come from traveller reports until there's a sanctioned source.
update public.retailers set active = false where adapter = 'schiphol';
