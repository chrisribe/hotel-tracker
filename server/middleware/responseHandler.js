// HTMX-aware response helper
// Full page → renders layout-main wrapping the template
// HTMX partial → renders template fragment only
// JSON → res.json()
module.exports = (req, res, next) => {
  res.respondWithTemplateOrJson = (pageData, templatePath) => {
    if (!templatePath) return res.json(pageData);

    if (pageData.redirect) {
      if (req.headers['hx-request']) {
        res.header('HX-Redirect', pageData.redirect);
        return res.send('');
      }
      return res.redirect(pageData.redirect);
    }

    if (req.headers['hx-request']) {
      return res.render(templatePath, { pageData });
    }

    if (req.xhr || req.headers['accept'] === 'application/json') {
      return res.json(pageData);
    }

    return res.render('layout-main', {
      template: templatePath,
      pageData,
      pageAssets: pageData.pageAssets || {},
    });
  };
  next();
};
