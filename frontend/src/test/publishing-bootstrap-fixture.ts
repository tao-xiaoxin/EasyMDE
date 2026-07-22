export const publishingBootstrapFixture = {
  categoryLoadError: '',
  categoryOptions: [
    { id: '7', label: 'Guides', parentId: '' },
    { id: '12', label: 'Advanced', parentId: '7' }
  ],
  strings: {
    categories: 'Categories',
    close: 'Close publishing controls',
    excerpt: 'Excerpt',
    featuredImage: 'Featured image',
    open: 'Publish',
    password: 'Password',
    passwordRequired: 'Enter a password before submitting.',
    passwordVisibility: 'Password protected',
    privateVisibility: 'Private',
    publicVisibility: 'Public',
    removeFeaturedImage: 'Remove featured image',
    schedule: 'Schedule (UTC)',
    selectFeaturedImage: 'Select featured image',
    status: 'Status',
    sticky: 'Stick to the top of the front page',
    submitFailed: 'WordPress could not start the requested action.',
    submitting: 'Submitting...',
    tags: 'Tags',
    title: 'Publishing',
    useFeaturedImage: 'Use featured image',
    visibility: 'Visibility'
  },
  timeZone: 'UTC'
} as const;
