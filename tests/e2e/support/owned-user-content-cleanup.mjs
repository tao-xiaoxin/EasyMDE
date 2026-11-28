export function parseCleanupUserId(userId, invalidUserIdCode) {
  const normalized = String(userId ?? '').trim();
  const numeric = Number(normalized);
  if (!/^[1-9]\d*$/u.test(normalized) || !Number.isSafeInteger(numeric) || numeric <= 1) {
    throw new Error(invalidUserIdCode);
  }
  return numeric;
}

export function ownedUserContentCleanupPhp(userId, rawPostTypes, { invalidUserIdCode, invalidPostTypesCode }) {
  const numericUserId = parseCleanupUserId(userId, invalidUserIdCode);
  const entries = Array.isArray(rawPostTypes)
    ? rawPostTypes
    : typeof rawPostTypes === 'string'
      ? rawPostTypes.split(',')
      : [];
  const postTypes = [...new Set(entries.map((entry) => String(entry ?? '').trim()).filter(Boolean))];
  if (!postTypes.length || postTypes.some((entry) => !/^[a-z0-9_-]{1,20}$/u.test(entry))) {
    throw new Error(invalidPostTypesCode);
  }
  const phpPostTypes = postTypes.map((type) => JSON.stringify(type)).join(', ');
  return [
    `$user_id = (int) ${numericUserId};`,
    'if ( $user_id <= 1 ) { fwrite( STDERR, "invalid-e2e-cleanup-user-id" ); exit( 1 ); }',
    '$post_ids = get_posts( array(',
    '  "author" => $user_id,',
    `  "post_type" => array( ${phpPostTypes} ),`,
    '  "post_status" => array_values( get_post_stati() ),',
    '  "fields" => "ids",',
    '  "posts_per_page" => -1,',
    '  "no_found_rows" => true,',
    '  "suppress_filters" => true',
    ') );',
    'foreach ( $post_ids as $post_id ) {',
    '  if ( false === wp_delete_post( (int) $post_id, true ) ) {',
    '    fwrite( STDERR, "failed-to-delete-post:" . (int) $post_id );',
    '    exit( 1 );',
    '  }',
    '}'
  ].join(' ');
}
