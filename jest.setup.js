// jest.setup.js
// Variables d'environnement factices pour que les modules qui lisent
// process.env au chargement (ex: sebpayService.js, middleware/auth.js) ne
// plantent pas pendant les tests — aucune de ces valeurs n'est réelle.
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_jwt_refresh_secret';
process.env.SEBPAY_PUBLIC_KEY = process.env.SEBPAY_PUBLIC_KEY || 'pk_test_dummy';
process.env.SEBPAY_SECRET_KEY = process.env.SEBPAY_SECRET_KEY || 'test_secret_key_1234567890';
process.env.AT_API_KEY = process.env.AT_API_KEY || 'dummy';
process.env.AT_USERNAME = process.env.AT_USERNAME || 'sandbox';
