-- Total de mensagens (ZCARD), depois do backfill.
backfill()
return redis.call('ZCARD', index)
