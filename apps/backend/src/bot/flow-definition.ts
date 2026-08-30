import { MainCategory } from '@prisma/client';

/**
 * The complete GloAro conversation tree, exactly as approved in the V1
 * requirement document. This file is the source of truth that seeds the
 * `bot_flows` table; after seeding, copy can be edited from the admin panel's
 * Bot Menu screen without a redeploy.
 *
 * Node types
 *   MESSAGE  - sends `body`, then immediately continues to `nextKey`
 *   MENU     - sends `body` + `options`, waits for the customer to pick one
 *   QUESTION - sends `body`, waits for a reply, validates it, stores it in `fieldName`
 *   ACTION   - performs `action` (CREATE_LEAD | TRACK_ORDER | END)
 */

export type NodeType = 'MESSAGE' | 'MENU' | 'QUESTION' | 'ACTION';

export type FieldType =
  | 'text'
  | 'name'
  | 'email'
  | 'phone'
  | 'city'
  | 'pincode'
  | 'orderid'
  | 'longtext';

export interface FlowOption {
  /** What the customer types, e.g. "1". Also the id sent back when a row is tapped. */
  key: string;
  /** Shown in the menu body and stored as the answer when `fieldName` is set. */
  label: string;
  /** Node to move to when this option is chosen. */
  next: string;

  /**
   * Leading emoji, used as the option's icon. WhatsApp allows no images inside
   * an interactive row, so an emoji is the only icon a menu can carry.
   */
  emoji?: string;
  /** Second line under the title in a tappable list. Max 72 characters. */
  description?: string;
  /**
   * Overrides `label` as the row title when the label is too long for
   * WhatsApp's 24-character limit. The full label is still what gets stored.
   */
  menuTitle?: string;
}

export interface FlowNode {
  key: string;
  name: string;
  nodeType: NodeType;
  body: string;
  options?: FlowOption[];
  /**
   * MENU nodes: label on the button that opens the tappable list, e.g.
   * "Choose an option". Ignored when the menu renders as numbered text.
   */
  menuButton?: string;
  fieldName?: string;
  fieldType?: FieldType;
  isRequired?: boolean;
  nextKey?: string;
  action?: 'CREATE_LEAD' | 'TRACK_ORDER' | 'END';
  mainCategory?: MainCategory;
  subCategory?: string;
  imageUrl?: string;
  linkUrl?: string;
  sortOrder?: number;
}

// ---------------------------------------------------------------------------
// Shared copy
// ---------------------------------------------------------------------------

/** Appended to every menu so the customer always has a way out. */
export const NAV_HINT = '\n\n_Reply *0* for the main menu at any time._';
/** Appended to sub-menus, which also offer a step back instead of a full reset. */
export const SUBMENU_NAV_HINT =
  '\n\n_Reply *0* for the main menu, or *back* for the previous menu._';

const THANKS_BODY =
  '✅ Thank you! Your details have been recorded.\n\n' +
  'Our GloAro team will contact you shortly.\n\n' +
  'Your reference number: *{{leadRef}}*' +
  NAV_HINT;

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

export const FLOW_NODES: FlowNode[] = [
  // =========================================================================
  // Welcome / main menu
  // =========================================================================
  {
    key: 'WELCOME',
    name: 'Welcome & Main Menu',
    nodeType: 'MENU',
    // Menu bodies stop at the intro. The options themselves live only in
    // `options`, and are rendered either as a tappable list or as numbered text
    // depending on what the channel supports.
    body:
      '👋 Welcome to *GloAro*!\n' +
      "We're delighted to have you here.\n\n" +
      'GloAro is your one-stop platform for Business Networking, B2B & B2C Commerce, ' +
      'Technology Solutions, and Business Growth.',
    menuButton: 'Choose an option',
    options: [
      {
        key: '1',
        label: 'GloAro Mart',
        emoji: '🛒',
        description: 'Buy • Sell • Grow',
        next: 'MART_MENU',
      },
      {
        key: '2',
        label: 'GloAro Digital Network',
        emoji: '🤝',
        menuTitle: 'Digital Network',
        description: 'Business networking community',
        next: 'NETWORK_MENU',
      },
    ],
    sortOrder: 0,
  },

  // =========================================================================
  // GloAro Mart
  // =========================================================================
  {
    key: 'MART_MENU',
    name: 'GloAro Mart Menu',
    nodeType: 'MENU',
    body: '🛒 *GloAro Mart* – Buy • Sell • Grow\n\nWhat would you like to do?' + SUBMENU_NAV_HINT,
    menuButton: 'GloAro Mart',
    options: [
      {
        key: '1',
        label: 'B2B Marketplace',
        emoji: '🏭',
        description: 'Bulk buying and wholesale',
        next: 'MART_B2B_CATEGORY',
      },
      {
        key: '2',
        label: 'B2C Marketplace',
        emoji: '🛍️',
        description: 'Shop retail products',
        next: 'MART_B2C_MENU',
      },
      {
        key: '3',
        label: 'Become a Seller',
        emoji: '🤝',
        description: 'List your products on GloAro',
        next: 'SELLER_BUSINESS_NAME',
      },
      {
        key: '4',
        label: 'Track My Order',
        emoji: '📦',
        description: 'Check your order status',
        next: 'TRACK_ORDER_ID',
      },
      {
        key: '5',
        label: 'Contact Sales Team',
        emoji: '📞',
        description: 'Talk to a sales executive',
        next: 'SALES_NAME',
      },
    ],
    sortOrder: 10,
  },

  // ------------------------------- B2B --------------------------------------
  {
    key: 'MART_B2B_CATEGORY',
    name: 'B2B – Product Category',
    nodeType: 'MENU',
    body: '🏭 *B2B Marketplace*\n\nWhich category are you interested in?' + SUBMENU_NAV_HINT,
    menuButton: 'Select category',
    fieldName: 'productCategory',
    options: [
      { key: '1', label: 'Food & FMCG', emoji: '🍲', next: 'MART_B2B_COMPANY' },
      { key: '2', label: 'Electronics', emoji: '💻', next: 'MART_B2B_COMPANY' },
      { key: '3', label: 'Fashion & Garments', emoji: '👗', next: 'MART_B2B_COMPANY' },
      { key: '4', label: 'Industrial Products', emoji: '⚙️', next: 'MART_B2B_COMPANY' },
      { key: '5', label: 'Other Products', emoji: '📦', next: 'MART_B2B_COMPANY' },
    ],
    sortOrder: 11,
  },
  {
    key: 'MART_B2B_COMPANY',
    name: 'B2B – Company Name',
    nodeType: 'QUESTION',
    body: 'Great choice! 📋\n\nPlease share your *Company Name*:',
    fieldName: 'businessName',
    fieldType: 'text',
    nextKey: 'MART_B2B_CONTACT',
    sortOrder: 12,
  },
  {
    key: 'MART_B2B_CONTACT',
    name: 'B2B – Contact Person',
    nodeType: 'QUESTION',
    body: 'Please share the *Contact Person* name:',
    fieldName: 'name',
    fieldType: 'name',
    nextKey: 'MART_B2B_MOBILE',
    sortOrder: 13,
  },
  {
    key: 'MART_B2B_MOBILE',
    name: 'B2B – Mobile Number',
    nodeType: 'QUESTION',
    body: 'Please share your *Mobile Number*:',
    fieldName: 'mobile',
    fieldType: 'phone',
    nextKey: 'MART_B2B_REQUIREMENT',
    sortOrder: 14,
  },
  {
    key: 'MART_B2B_REQUIREMENT',
    name: 'B2B – Product Requirement',
    nodeType: 'QUESTION',
    body:
      'Please describe your *Product Requirement*\n' +
      '_(product, quantity, and any specifications)_:',
    fieldName: 'requirement',
    fieldType: 'longtext',
    nextKey: 'MART_B2B_CREATE',
    sortOrder: 15,
  },
  {
    key: 'MART_B2B_CREATE',
    name: 'B2B – Create Lead',
    nodeType: 'ACTION',
    action: 'CREATE_LEAD',
    mainCategory: MainCategory.GLOARO_MART,
    subCategory: 'B2B_MARKETPLACE',
    body: THANKS_BODY,
    sortOrder: 16,
  },

  // ------------------------------- B2C --------------------------------------
  {
    key: 'MART_B2C_MENU',
    name: 'B2C Marketplace Menu',
    nodeType: 'MENU',
    body: '🛍️ *B2C Marketplace*\n\nHow can we help you today?' + SUBMENU_NAV_HINT,
    menuButton: 'Choose an option',
    options: [
      {
        key: '1',
        label: 'Browse Products',
        emoji: '🛍️',
        description: 'See our full product range',
        next: 'MART_B2C_BROWSE',
      },
      {
        key: '2',
        label: 'Latest Offers',
        emoji: '🏷️',
        description: 'Current deals and discounts',
        next: 'MART_B2C_OFFERS',
      },
      {
        key: '3',
        label: 'Customer Support',
        emoji: '💬',
        description: 'Raise a support request',
        next: 'SUPPORT_NAME',
      },
    ],
    sortOrder: 20,
  },
  {
    key: 'MART_B2C_BROWSE',
    name: 'B2C – Browse Products',
    nodeType: 'MESSAGE',
    body:
      '🛍️ *Browse GloAro Mart*\n\n' +
      'Explore our full product range here:\n' +
      '{{websiteUrl}}\n\n' +
      'Shop across Food & FMCG, Electronics, Fashion, Industrial Products and more.' +
      NAV_HINT,
    nextKey: 'MART_B2C_MENU',
    sortOrder: 21,
  },
  {
    key: 'MART_B2C_OFFERS',
    name: 'B2C – Latest Offers',
    nodeType: 'MESSAGE',
    body:
      '🎉 *Latest Offers*\n\n' +
      'Our current deals and seasonal offers are updated here:\n' +
      '{{websiteUrl}}\n\n' +
      'Follow us to never miss a GloAro deal!' +
      NAV_HINT,
    nextKey: 'MART_B2C_MENU',
    sortOrder: 22,
  },

  // ---------------------------- Customer support ----------------------------
  {
    key: 'SUPPORT_NAME',
    name: 'Support – Name',
    nodeType: 'QUESTION',
    body: '🎧 *Customer Support*\n\nPlease share your *Name*:',
    fieldName: 'name',
    fieldType: 'name',
    nextKey: 'SUPPORT_MOBILE',
    sortOrder: 23,
  },
  {
    key: 'SUPPORT_MOBILE',
    name: 'Support – Mobile Number',
    nodeType: 'QUESTION',
    body: 'Please share your *Mobile Number*:',
    fieldName: 'mobile',
    fieldType: 'phone',
    nextKey: 'SUPPORT_REQUIREMENT',
    sortOrder: 24,
  },
  {
    key: 'SUPPORT_REQUIREMENT',
    name: 'Support – Issue',
    nodeType: 'QUESTION',
    body: 'Please describe how we can help you:',
    fieldName: 'requirement',
    fieldType: 'longtext',
    nextKey: 'SUPPORT_CREATE',
    sortOrder: 25,
  },
  {
    key: 'SUPPORT_CREATE',
    name: 'Support – Create Request',
    nodeType: 'ACTION',
    action: 'CREATE_LEAD',
    mainCategory: MainCategory.GLOARO_MART,
    subCategory: 'CUSTOMER_SUPPORT',
    body:
      '✅ Thank you! Your support request has been registered.\n\n' +
      'Our team will get back to you shortly.\n\n' +
      'Your reference number: *{{leadRef}}*' +
      NAV_HINT,
    sortOrder: 26,
  },

  // ---------------------------- Become a Seller -----------------------------
  {
    key: 'SELLER_BUSINESS_NAME',
    name: 'Seller – Business Name',
    nodeType: 'QUESTION',
    body:
      '🏪 *Become a GloAro Seller*\n\n' +
      'Sell to thousands of buyers across our B2B and B2C marketplace.\n\n' +
      'Please share your *Business Name*:',
    fieldName: 'businessName',
    fieldType: 'text',
    nextKey: 'SELLER_OWNER_NAME',
    sortOrder: 30,
  },
  {
    key: 'SELLER_OWNER_NAME',
    name: 'Seller – Owner Name',
    nodeType: 'QUESTION',
    body: 'Please share the *Owner Name*:',
    fieldName: 'name',
    fieldType: 'name',
    nextKey: 'SELLER_MOBILE',
    sortOrder: 31,
  },
  {
    key: 'SELLER_MOBILE',
    name: 'Seller – Mobile Number',
    nodeType: 'QUESTION',
    body: 'Please share your *Mobile Number*:',
    fieldName: 'mobile',
    fieldType: 'phone',
    nextKey: 'SELLER_CATEGORY',
    sortOrder: 32,
  },
  {
    key: 'SELLER_CATEGORY',
    name: 'Seller – Product Category',
    nodeType: 'MENU',
    body: 'Which *Product Category* do you sell?' + SUBMENU_NAV_HINT,
    menuButton: 'Select category',
    fieldName: 'productCategory',
    options: [
      { key: '1', label: 'Food & FMCG', emoji: '🍲', next: 'SELLER_LOCATION' },
      { key: '2', label: 'Electronics', emoji: '💻', next: 'SELLER_LOCATION' },
      { key: '3', label: 'Fashion & Garments', emoji: '👗', next: 'SELLER_LOCATION' },
      { key: '4', label: 'Industrial Products', emoji: '⚙️', next: 'SELLER_LOCATION' },
      { key: '5', label: 'Other Products', emoji: '📦', next: 'SELLER_LOCATION' },
    ],
    sortOrder: 33,
  },
  {
    key: 'SELLER_LOCATION',
    name: 'Seller – Business Location',
    nodeType: 'QUESTION',
    body: 'Please share your *Business Location* (City):',
    fieldName: 'city',
    fieldType: 'city',
    nextKey: 'SELLER_CREATE',
    sortOrder: 34,
  },
  {
    key: 'SELLER_CREATE',
    name: 'Seller – Create Lead',
    nodeType: 'ACTION',
    action: 'CREATE_LEAD',
    mainCategory: MainCategory.GLOARO_MART,
    subCategory: 'BECOME_SELLER',
    body:
      '✅ Thank you for your interest in selling on GloAro!\n\n' +
      'Our onboarding team will contact you shortly to complete your registration.\n\n' +
      'Your reference number: *{{leadRef}}*' +
      NAV_HINT,
    sortOrder: 35,
  },

  // ----------------------------- Track My Order -----------------------------
  {
    key: 'TRACK_ORDER_ID',
    name: 'Track Order – Order ID',
    nodeType: 'QUESTION',
    body: '📦 *Track My Order*\n\nPlease share your *Order ID*:',
    fieldName: 'orderId',
    fieldType: 'orderid',
    nextKey: 'TRACK_ORDER_LOOKUP',
    sortOrder: 40,
  },
  {
    key: 'TRACK_ORDER_LOOKUP',
    name: 'Track Order – Lookup',
    nodeType: 'ACTION',
    action: 'TRACK_ORDER',
    mainCategory: MainCategory.GLOARO_MART,
    subCategory: 'TRACK_ORDER',
    // Used only when the order API is unavailable and a support request is raised.
    body:
      "📦 We couldn't fetch live status for order *{{orderId}}* right now.\n\n" +
      'We have raised a support request and our team will update you shortly.\n\n' +
      'Your reference number: *{{leadRef}}*' +
      NAV_HINT,
    sortOrder: 41,
  },

  // --------------------------- Contact Sales Team ---------------------------
  {
    key: 'SALES_NAME',
    name: 'Sales – Name',
    nodeType: 'QUESTION',
    body: '💼 *Contact Sales Team*\n\nPlease share your *Name*:',
    fieldName: 'name',
    fieldType: 'name',
    nextKey: 'SALES_MOBILE',
    sortOrder: 50,
  },
  {
    key: 'SALES_MOBILE',
    name: 'Sales – Mobile Number',
    nodeType: 'QUESTION',
    body: 'Please share your *Mobile Number*:',
    fieldName: 'mobile',
    fieldType: 'phone',
    nextKey: 'SALES_REQUIREMENT',
    sortOrder: 51,
  },
  {
    key: 'SALES_REQUIREMENT',
    name: 'Sales – Requirement',
    nodeType: 'QUESTION',
    body: 'Please describe your *Requirement*:',
    fieldName: 'requirement',
    fieldType: 'longtext',
    nextKey: 'SALES_CREATE',
    sortOrder: 52,
  },
  {
    key: 'SALES_CREATE',
    name: 'Sales – Create Lead',
    nodeType: 'ACTION',
    action: 'CREATE_LEAD',
    mainCategory: MainCategory.GLOARO_MART,
    subCategory: 'CONTACT_SALES',
    body: THANKS_BODY,
    sortOrder: 53,
  },

  // =========================================================================
  // GloAro Digital Network
  // =========================================================================
  {
    key: 'NETWORK_MENU',
    name: 'Digital Network Menu',
    nodeType: 'MENU',
    body: '🤝 *GloAro Digital Network*\nBusiness Networking Community\n\nWhat would you like to explore?' + SUBMENU_NAV_HINT,
    menuButton: 'Digital Network',
    options: [
      {
        key: '1',
        label: 'About GloAro',
        emoji: 'ℹ️',
        description: 'Who we are and what we do',
        next: 'NETWORK_ABOUT',
      },
      {
        key: '2',
        label: 'Membership Benefits',
        emoji: '⭐',
        menuTitle: 'Membership',
        description: 'What members get',
        next: 'MEMBERSHIP_INFO',
      },
      {
        key: '3',
        label: 'Chapters',
        emoji: '📍',
        description: 'Find your city chapter',
        next: 'CHAPTERS_CITY',
      },
      {
        key: '4',
        label: 'Franchise Opportunity',
        emoji: '🏢',
        menuTitle: 'Franchise',
        description: 'Run a GloAro franchise',
        next: 'FRANCHISE_INFO',
      },
      {
        key: '5',
        label: 'Join GloAro',
        emoji: '✍️',
        description: 'Become a member',
        next: 'JOIN_NAME',
      },
      {
        key: '6',
        label: 'Upcoming Events',
        emoji: '📅',
        description: 'Meetups and workshops',
        next: 'EVENTS_MENU',
      },
      {
        key: '7',
        label: 'Contact Team',
        emoji: '📞',
        description: 'Speak to our team',
        next: 'NETWORK_CONTACT',
      },
    ],
    sortOrder: 60,
  },

  {
    key: 'NETWORK_ABOUT',
    name: 'About GloAro',
    nodeType: 'MESSAGE',
    body:
      'ℹ️ *About GloAro Digital Network*\n\n' +
      'GloAro is a business networking community built to help entrepreneurs grow ' +
      'through trusted relationships.\n\n' +
      '🔄 *Referrals* – Give and receive qualified business referrals within a trusted circle.\n\n' +
      '🤝 *Connections* – Meet verified business owners across industries and cities.\n\n' +
      '🎓 *Expert Learning* – Learn directly from experienced entrepreneurs and guest speakers.\n\n' +
      '🧩 *Collaboration* – Find partners, suppliers and co-creators for new opportunities.\n\n' +
      '📈 *Business Growth* – Turn every connection into measurable growth for your business.' +
      NAV_HINT,
    nextKey: 'NETWORK_MENU',
    sortOrder: 61,
  },

  // ---------------------------- Membership ----------------------------------
  {
    key: 'MEMBERSHIP_INFO',
    name: 'Membership Benefits',
    nodeType: 'MESSAGE',
    body:
      '⭐ *GloAro Membership Benefits*\n\n' +
      '• Weekly referral and networking meetings\n' +
      '• Access to a verified community of business owners\n' +
      '• Qualified business referrals throughout the year\n' +
      '• Guest speaker and expert learning sessions\n' +
      '• Business growth workshops and training\n' +
      '• Visibility across the GloAro network and chapters\n' +
      '• Collaboration and partnership opportunities\n\n' +
      "Let's get you registered — just a few quick details.",
    nextKey: 'MEMBERSHIP_NAME',
    sortOrder: 70,
  },
  {
    key: 'MEMBERSHIP_NAME',
    name: 'Membership – Full Name',
    nodeType: 'QUESTION',
    body: 'Please share your *Full Name*:',
    fieldName: 'name',
    fieldType: 'name',
    nextKey: 'MEMBERSHIP_MOBILE',
    sortOrder: 71,
  },
  {
    key: 'MEMBERSHIP_MOBILE',
    name: 'Membership – Mobile Number',
    nodeType: 'QUESTION',
    body: 'Please share your *Mobile Number*:',
    fieldName: 'mobile',
    fieldType: 'phone',
    nextKey: 'MEMBERSHIP_EMAIL',
    sortOrder: 72,
  },
  {
    key: 'MEMBERSHIP_EMAIL',
    name: 'Membership – Email',
    nodeType: 'QUESTION',
    body: 'Please share your *Email*:',
    fieldName: 'email',
    fieldType: 'email',
    nextKey: 'MEMBERSHIP_BUSINESS',
    sortOrder: 73,
  },
  {
    key: 'MEMBERSHIP_BUSINESS',
    name: 'Membership – Business Name',
    nodeType: 'QUESTION',
    body: 'Please share your *Business Name*:',
    fieldName: 'businessName',
    fieldType: 'text',
    nextKey: 'MEMBERSHIP_CATEGORY',
    sortOrder: 74,
  },
  {
    key: 'MEMBERSHIP_CATEGORY',
    name: 'Membership – Business Category',
    nodeType: 'QUESTION',
    body: 'Please share your *Business Category*\n_(e.g. Manufacturing, Retail, IT Services)_:',
    fieldName: 'businessCategory',
    fieldType: 'text',
    nextKey: 'MEMBERSHIP_CITY',
    sortOrder: 75,
  },
  {
    key: 'MEMBERSHIP_CITY',
    name: 'Membership – City',
    nodeType: 'QUESTION',
    body: 'Please share your *City*:',
    fieldName: 'city',
    fieldType: 'city',
    nextKey: 'MEMBERSHIP_CREATE',
    sortOrder: 76,
  },
  {
    key: 'MEMBERSHIP_CREATE',
    name: 'Membership – Create Lead',
    nodeType: 'ACTION',
    action: 'CREATE_LEAD',
    mainCategory: MainCategory.DIGITAL_NETWORK,
    subCategory: 'MEMBERSHIP',
    body:
      '✅ Thank you! Your membership enquiry has been received.\n\n' +
      'Our membership team will contact you shortly with the next steps.\n\n' +
      'Your reference number: *{{leadRef}}*' +
      NAV_HINT,
    sortOrder: 77,
  },

  // ------------------------------ Chapters ----------------------------------
  {
    key: 'CHAPTERS_CITY',
    name: 'Chapters – City / PIN Code',
    nodeType: 'QUESTION',
    body:
      '📍 *GloAro Chapters*\n\n' +
      'Please share your *City* or *PIN Code* and we will share the nearest chapter details:',
    fieldName: 'city',
    fieldType: 'city',
    nextKey: 'CHAPTERS_CREATE',
    sortOrder: 80,
  },
  {
    key: 'CHAPTERS_CREATE',
    name: 'Chapters – Create Lead',
    nodeType: 'ACTION',
    action: 'CREATE_LEAD',
    mainCategory: MainCategory.DIGITAL_NETWORK,
    subCategory: 'CHAPTERS',
    body:
      '✅ Thank you!\n\n' +
      'Our team will share the chapter details for *{{city}}* with you shortly.\n\n' +
      'Your reference number: *{{leadRef}}*' +
      NAV_HINT,
    sortOrder: 81,
  },

  // ------------------------------ Franchise ---------------------------------
  {
    key: 'FRANCHISE_INFO',
    name: 'Franchise Opportunity',
    nodeType: 'MESSAGE',
    body:
      '🚀 *GloAro Franchise Opportunity*\n\n' +
      '• Run your own GloAro chapter in your city\n' +
      '• Proven business networking model\n' +
      '• Complete training and onboarding support\n' +
      '• Recurring membership revenue\n' +
      '• Brand, marketing and operational support\n' +
      '• Exclusive territory rights\n\n' +
      'Please share a few details and our franchise team will reach out.',
    nextKey: 'FRANCHISE_NAME',
    sortOrder: 90,
  },
  {
    key: 'FRANCHISE_NAME',
    name: 'Franchise – Name',
    nodeType: 'QUESTION',
    body: 'Please share your *Name*:',
    fieldName: 'name',
    fieldType: 'name',
    nextKey: 'FRANCHISE_MOBILE',
    sortOrder: 91,
  },
  {
    key: 'FRANCHISE_MOBILE',
    name: 'Franchise – Mobile Number',
    nodeType: 'QUESTION',
    body: 'Please share your *Mobile Number*:',
    fieldName: 'mobile',
    fieldType: 'phone',
    nextKey: 'FRANCHISE_CITY',
    sortOrder: 92,
  },
  {
    key: 'FRANCHISE_CITY',
    name: 'Franchise – City',
    nodeType: 'QUESTION',
    body: 'Which *City* are you interested in?',
    fieldName: 'city',
    fieldType: 'city',
    nextKey: 'FRANCHISE_CREATE',
    sortOrder: 93,
  },
  {
    key: 'FRANCHISE_CREATE',
    name: 'Franchise – Create Lead',
    nodeType: 'ACTION',
    action: 'CREATE_LEAD',
    mainCategory: MainCategory.DIGITAL_NETWORK,
    subCategory: 'FRANCHISE',
    body:
      '✅ Thank you for your interest in a GloAro franchise!\n\n' +
      'Our franchise team will contact you shortly.\n\n' +
      'Your reference number: *{{leadRef}}*' +
      NAV_HINT,
    sortOrder: 94,
  },

  // ------------------------------ Join GloAro -------------------------------
  {
    key: 'JOIN_NAME',
    name: 'Join – Full Name',
    nodeType: 'QUESTION',
    body:
      '🎉 *Join GloAro*\n\n' +
      "Wonderful! Let's get you started.\n\n" +
      'Please share your *Full Name*:',
    fieldName: 'name',
    fieldType: 'name',
    nextKey: 'JOIN_MOBILE',
    sortOrder: 100,
  },
  {
    key: 'JOIN_MOBILE',
    name: 'Join – Mobile Number',
    nodeType: 'QUESTION',
    body: 'Please share your *Mobile Number*:',
    fieldName: 'mobile',
    fieldType: 'phone',
    nextKey: 'JOIN_EMAIL',
    sortOrder: 101,
  },
  {
    key: 'JOIN_EMAIL',
    name: 'Join – Email',
    nodeType: 'QUESTION',
    body: 'Please share your *Email*:',
    fieldName: 'email',
    fieldType: 'email',
    nextKey: 'JOIN_BUSINESS',
    sortOrder: 102,
  },
  {
    key: 'JOIN_BUSINESS',
    name: 'Join – Business Name',
    nodeType: 'QUESTION',
    body: 'Please share your *Business Name*:',
    fieldName: 'businessName',
    fieldType: 'text',
    nextKey: 'JOIN_CATEGORY',
    sortOrder: 103,
  },
  {
    key: 'JOIN_CATEGORY',
    name: 'Join – Business Category',
    nodeType: 'QUESTION',
    body: 'Please share your *Business Category*\n_(e.g. Manufacturing, Retail, IT Services)_:',
    fieldName: 'businessCategory',
    fieldType: 'text',
    nextKey: 'JOIN_CITY',
    sortOrder: 104,
  },
  {
    key: 'JOIN_CITY',
    name: 'Join – City',
    nodeType: 'QUESTION',
    body: 'Please share your *City*:',
    fieldName: 'city',
    fieldType: 'city',
    nextKey: 'JOIN_CREATE',
    sortOrder: 105,
  },
  {
    key: 'JOIN_CREATE',
    name: 'Join – Create Lead',
    nodeType: 'ACTION',
    action: 'CREATE_LEAD',
    mainCategory: MainCategory.DIGITAL_NETWORK,
    subCategory: 'JOIN_GLOARO',
    body:
      '🎉 Welcome aboard, {{name}}!\n\n' +
      'Your request to join GloAro has been received. Our team will contact you shortly ' +
      'to complete your onboarding.\n\n' +
      'Your reference number: *{{leadRef}}*' +
      NAV_HINT,
    sortOrder: 106,
  },

  // -------------------------------- Events ----------------------------------
  {
    key: 'EVENTS_MENU',
    name: 'Upcoming Events',
    nodeType: 'MENU',
    body:
      '📅 *Upcoming GloAro Events*\n\n' +
      '🤝 *Business Meetups* – Meet and connect with business owners in your city\n' +
      '🎤 *Guest Speaker Sessions* – Learn from industry experts and successful entrepreneurs\n' +
      '🔄 *Referral Meetings* – Structured meetings to exchange qualified referrals\n' +
      '📈 *Business Growth Workshops* – Practical training to scale your business' +
      SUBMENU_NAV_HINT,
    menuButton: 'Register now',
    options: [
      {
        key: '1',
        label: 'Register for an event',
        emoji: '📝',
        menuTitle: 'Register for event',
        description: 'Reserve your place',
        next: 'EVENT_NAME',
      },
    ],
    sortOrder: 110,
  },
  {
    key: 'EVENT_NAME',
    name: 'Event – Name',
    nodeType: 'QUESTION',
    body: '📝 *Event Registration*\n\nPlease share your *Name*:',
    fieldName: 'name',
    fieldType: 'name',
    nextKey: 'EVENT_MOBILE',
    sortOrder: 111,
  },
  {
    key: 'EVENT_MOBILE',
    name: 'Event – Mobile Number',
    nodeType: 'QUESTION',
    body: 'Please share your *Mobile Number*:',
    fieldName: 'mobile',
    fieldType: 'phone',
    nextKey: 'EVENT_EMAIL',
    sortOrder: 112,
  },
  {
    key: 'EVENT_EMAIL',
    name: 'Event – Email',
    nodeType: 'QUESTION',
    body: 'Please share your *Email*:',
    fieldName: 'email',
    fieldType: 'email',
    nextKey: 'EVENT_CITY',
    sortOrder: 113,
  },
  {
    key: 'EVENT_CITY',
    name: 'Event – City',
    nodeType: 'QUESTION',
    body: 'Please share your *City*:',
    fieldName: 'city',
    fieldType: 'city',
    nextKey: 'EVENT_CREATE',
    sortOrder: 114,
  },
  {
    key: 'EVENT_CREATE',
    name: 'Event – Create Lead',
    nodeType: 'ACTION',
    action: 'CREATE_LEAD',
    mainCategory: MainCategory.DIGITAL_NETWORK,
    subCategory: 'EVENT_REGISTRATION',
    body:
      '✅ You are registered!\n\n' +
      'Our events team will share the date, time and venue details with you shortly.\n\n' +
      'Your reference number: *{{leadRef}}*' +
      NAV_HINT,
    sortOrder: 115,
  },

  // ----------------------------- Contact Team -------------------------------
  {
    key: 'NETWORK_CONTACT',
    name: 'Contact Team',
    nodeType: 'MESSAGE',
    body:
      '📞 *Contact the GloAro Team*\n\n' +
      '☎️ Phone: {{supportPhone}}\n' +
      '📧 Email: {{supportEmail}}\n' +
      '🌐 Website: {{websiteUrl}}\n\n' +
      'You can also tell us what you need and our team will call you back.',
    nextKey: 'NETWORK_CONTACT_REQUIREMENT',
    sortOrder: 120,
  },
  {
    key: 'NETWORK_CONTACT_REQUIREMENT',
    name: 'Contact Team – Requirement',
    nodeType: 'QUESTION',
    body: 'Please describe your *Requirement*:',
    fieldName: 'requirement',
    fieldType: 'longtext',
    nextKey: 'NETWORK_CONTACT_CREATE',
    sortOrder: 121,
  },
  {
    key: 'NETWORK_CONTACT_CREATE',
    name: 'Contact Team – Create Lead',
    nodeType: 'ACTION',
    action: 'CREATE_LEAD',
    mainCategory: MainCategory.DIGITAL_NETWORK,
    subCategory: 'CONTACT_TEAM',
    body: THANKS_BODY,
    sortOrder: 122,
  },
];

/** Fast lookup used by the engine when the DB copy has not been loaded yet. */
export const FLOW_BY_KEY: Record<string, FlowNode> = Object.fromEntries(
  FLOW_NODES.map((n) => [n.key, n]),
);
