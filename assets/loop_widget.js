var LoopSubscriptions = (function () {
    const LOOP_APP_ID = "5284869";
    const LOOP_WIDGET_USE_COMPARE_AT_PRICE = false;
    const LOOP_WIDGET_VARIANT_ID_SELECTORS = ['input[name="id"]'];
    const LOOP_WIDGET_SELLING_PLAN_SELECTOR = 'input[name="selling_plan"]';
    const LOOP_CDN_URL = "https://cdn.loopwork.co";
    const LOOP_WIDGET_PRODUCT_QUANTITY_SELECTORS = [".quantity__input"];
    const OBSERVER_ATTRIBUTE_NAMES = ['value', 'variant'];
    const LOOP_ALL_COUNTRY_SELECTOR = "__ALL__";
    const localesWithRegion = ["zh-CN", "zh-TW", "pt-BR", "pt-PT"];

    // ***************** Entry point ******************
    async function startLoopWidget(productId) {
        try {
            console.time("renderLoopWidget");
            widgetLogger("product info", window.LOOP_WIDGET);
            observeLoopWidgetVariantChange(productId);
            generateLoopWidgetVariantSPMaps(productId);
            await loadData(productId);
            renderLoopWidgetContainer(productId);
            loopWidgetProcessBundleProduct(productId);
            handleLoopWidgetSkeletonLoader(productId);
            listenLoopWidgetAddToCartCustomEvent(productId);
        } catch (error) {
            widgetLogger(`Error loading Loop subscriptions widget: ${error?.message}`, error);
            hideLoopWidget(productId, "startLoopWidget");
            hideLoopWidgetLoader(productId);
        } finally {
            console.timeEnd("renderLoopWidget");
        }
    }

    async function loadData(productId) {
        const { storeJson, baseUrl } = await fetchStoreData(productId);
        await Promise.all([
            fetchWidgetAssets(productId, storeJson, baseUrl),
            getLoopWidgetCountryFilteredSellingPlans(productId),
            fetchPresetBundleData(productId, storeJson, baseUrl),
            getLoopWidgetPrepaidSellingPlans(productId),
        ]);
    }

    // ***************** Fetch and Data Loading Functions ******************
    async function fetchStoreData(productId) {
        const myShopifyDomain = window.Shopify.shop;
        const baseUrl = `${LOOP_CDN_URL}/${myShopifyDomain}`;

        const storesRes = await fetchWithCacheControl(`${baseUrl}/store.json`, "store");
        if (!storesRes) {
            throw new Error("Cannot connect to Loop widget CDN");
        }

        const storeJson = await storesRes.json();
        if (!storeJson) {
            throw new Error("Cannot fetch store data");
        }

        window.LOOP_WIDGET[productId].storeJson = { ...storeJson };

        if (!storeJson.isStorefrontWidgetPublished) {
            throw new Error("Widget is not published");
        }

        return { storeJson, baseUrl };
    }

    async function fetchWidgetAssets(productId, storeJson, baseUrl) {
        const themeId = window?.Shopify?.theme?.id;
        const templateName = window.LOOP_WIDGET[productId].templateName || "default";
        const widgetId = storeJson?.widgetMapping?.[themeId]?.[templateName];

        if (!widgetId) {
            throw new Error(`No widget found for template: ${templateName}`);
        }

        const locale = getLocale();
        const preferencesCdnUrl = `${baseUrl}/widgets/${widgetId}/preferences.json`;
        const stylesCdnUrl = `${baseUrl}/widgets/${widgetId}/styles.css`;

        const [texts, preferencesResponse, stylesResponse] = await Promise.all([
            fetchTextData(baseUrl, widgetId, locale, storeJson?.storeDefaultLocale),
            fetchWithCacheControl(preferencesCdnUrl, "preferences"),
            fetchWithCacheControl(stylesCdnUrl, "styles"),
        ]);

        const [preferences, styles] = await Promise.all([
            preferencesResponse.json(),
            stylesResponse.text(),
        ]);

        window.LOOP_WIDGET[productId].texts = texts;
        window.LOOP_WIDGET[productId].preferences = preferences;

        const styleElement = document.createElement("style");
        styleElement.textContent = styles;
        styleElement.id = `loop-widget-styles-id-${productId}`;
        document.body.appendChild(styleElement);
    }

    async function fetchPresetBundleData(productId, storeJson, baseUrl) {
        if (storeJson.hasPresetBundles && storeJson.presetBundleShopifyProductIds.includes(productId)) {
            const presetUrl = `${baseUrl}/presetBundles/${productId}.json`;
            const presetRes = await fetchWithCacheControl(presetUrl, "preset");
            const productBundleData = await presetRes.json();
            window.LOOP_WIDGET[productId]["productBundleData"] = { ...productBundleData };
        }
    }

    async function fetchTextData(baseUrl, widgetId, locale, storeDefaultLocale) {
        let textCdnUrl = `${baseUrl}/widgets/${widgetId}/texts.json`;

        if (locale && storeDefaultLocale && storeDefaultLocale !== locale) {
            textCdnUrl = `${baseUrl}/widgets/${widgetId}/texts-${locale}.json`;
        }

        try {
            const textResponse = await fetchWithCacheControl(textCdnUrl, "text");
            if (!textResponse.ok) {
                throw new Error("Localized text fetch failed");
            }
            const data = await textResponse.json();
            if (!data.length) {
                throw new Error("Localized text fetch failed");
            }
            return data;
        } catch (error) {
            console.warn("Falling back to non-localized text fetch:", error.message);
            const fallbackTextResponse = await fetchWithCacheControl(`${baseUrl}/widgets/${widgetId}/texts.json`, 'text');
            if (!fallbackTextResponse.ok) {
                throw new Error("Non-localized text fetch failed");
            }
            return await fallbackTextResponse.json();
        }
    }

    const fetchWithCacheControl = async (url, key) => {
        return fetch(url);
    };

    async function getLoopWidgetPrepaidSellingPlans(productId) {
        if (!window.LOOP_WIDGET[productId].storeJson.hasPrepaid) {
            return;
        }
        const sps =
            window.LOOP_WIDGET[productId].product.selling_plan_groups?.flatMap((spg) => {
                return spg?.selling_plans.map((sp) => sp.id);
            }) || [];

        const spIdsAsString = sps.join(",");

        const prepaidUrl = `${window.LOOP_WIDGET[productId].storeJson.apiUrl.prepaidSellingPlans}?shopifyIds=${spIdsAsString}`;
        const prepaidRes = await fetch(prepaidUrl, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
        });
        const prepaidResJSON = await prepaidRes.json();
        const prepaidData = prepaidResJSON.data;
        window.LOOP_WIDGET[productId]["prepaidSellingPlans"] =
            prepaidData?.sellingPlans || {};
    }

    async function getLoopWidgetCountryFilteredSellingPlans(productId) {
        try {
            if (!window.LOOP_WIDGET[productId].storeJson.isSellingPlanCountryMappingEnabled) {
                return;
            }
            const spShopifyIds =
                window.LOOP_WIDGET[productId].product.selling_plan_groups?.flatMap((spg) => {
                    return spg?.selling_plans.map((sp) => sp.id);
                }) || [];
            const countryCode = window?.Shopify?.country || LOOP_ALL_COUNTRY_SELECTOR;
            const body = {
                sellingPlanShopifyIds: spShopifyIds,
                countryCode: countryCode,
            };

            const apiUrl = `${window.LOOP_WIDGET[productId].storeJson.apiUrl.sellingPlanCountryFilter}`;
            const authorization = window.LOOP_WIDGET[productId].storeJson.sentinalAuthToken;
            const apiRes = await fetch(apiUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "authorization": authorization,
                },
                body: JSON.stringify(body),
            });
            const apiResJSON = await apiRes.json();
            const apiData = apiResJSON.data;
            window.LOOP_WIDGET[productId]["countryFilteredSellingPlanShopifyIds"] = apiData?.filteredSellingPlanShopifyIds || [];
        } catch (err) {
            widgetLogger("Error occurred while filtering selling plans", err)
        }
    }

    // ***************** Utility / Helper Functions ******************
    function generateLoopWidgetVariantSPMaps(productId) {
        const variantToSellingPlanGroups = {};
        const variantToSellingPlans = {};
        const sellingPlanGroupToSellingPlans = {};

        window.LOOP_WIDGET[productId]['product'].variants.forEach(variant => {
            variantToSellingPlanGroups[variant.id] = [];
            variantToSellingPlans[variant.id] = {};

            variant.selling_plan_allocations.forEach(allocation => {
                if (!variantToSellingPlanGroups[variant.id].includes(allocation.selling_plan_group_id)) {
                    variantToSellingPlanGroups[variant.id].push(allocation.selling_plan_group_id);
                }
                if (!variantToSellingPlans[variant.id][allocation.selling_plan_group_id]) {
                    variantToSellingPlans[variant.id][allocation.selling_plan_group_id] = [];
                }
                variantToSellingPlans[variant.id][allocation.selling_plan_group_id].push(allocation.selling_plan_id);
                if (!sellingPlanGroupToSellingPlans[allocation.selling_plan_group_id]) {
                    sellingPlanGroupToSellingPlans[allocation.selling_plan_group_id] = [];
                }
                if (!sellingPlanGroupToSellingPlans[allocation.selling_plan_group_id].includes(allocation.selling_plan_id)) {
                    sellingPlanGroupToSellingPlans[allocation.selling_plan_group_id].push(allocation.selling_plan_id);
                }
            });
        });

        window.LOOP_WIDGET[productId] = {
            ...window.LOOP_WIDGET[productId],
            variantToSellingPlanGroups,
            variantToSellingPlans,
            sellingPlanGroupToSellingPlans
        };
    }

    function getLocale() {
        const locale = window?.Shopify?.locale ? window.Shopify.locale : null;
        if (!locale) {
            return null;
        }
        if (localesWithRegion.includes(locale)) {
            return locale;
        }
        return locale.split("-")[0];
    }

    function widgetLogger(message, ...additionalData) {
        const prefix = "%cLoop Widget: ";
        let style = `background-color: #7D41FF; color: #FFFFFF; padding: 2px;`;
        console.log(prefix + message, style, ...additionalData);
    }

    function loopWidgetHasCommonElements(arr1, arr2) {
        const set1 = new Set(arr1);
        return arr2.some(elem => set1.has(elem));
    }

    function getCommonElements(arr1 = [], arr2 = []) {
        const set1 = new Set(arr1);
        return arr2.filter(elem => set1.has(elem));
    }

    function getLoopWidgetPreferenceByKey(productId, key) {
        const item = window.LOOP_WIDGET[productId].preferences.find(itm => itm.key === key)
        return item?.value;
    }

    function getLoopWidgetTextsByKey(productId, key) {
        const item = window.LOOP_WIDGET[productId].texts.find(itm => itm.key === key)
        return item?.value ?? '';
    }

    function getLoopWidgetVariantIdFromURL() {
        const url = new URL(document.URL);
        return url.searchParams.get("variant") || "";
    }

    function getLoopWidgetFirstAvailableVariantId(productId) {
        const variant = window.LOOP_WIDGET[productId].product.variants.find(v => v.available);
        return variant ? variant.id : window.LOOP_WIDGET[productId].product.variants[0].id;
    }

    function getLoopWidgetVariantId(productId) {
        return window.LOOP_WIDGET[productId]['selectedVariantId'] || getLoopWidgetVariantIdFromURL() || getLoopWidgetFirstAvailableVariantId(productId);
    }

    function getLoopWidgetVariantById(productId, variantId) {
        return window.LOOP_WIDGET[productId]['product'].variants.find(variant => variant.id == variantId);
    }

    function getLoopWidgetProductForms(productId, origin = document) {
        if (window.LOOP_WIDGET[productId]['loopWidgetProductForms']?.length) {
            return window.LOOP_WIDGET[productId]['loopWidgetProductForms'];
        }
        const variantIds = window.LOOP_WIDGET[productId].product.variants.map(v => v.id);
        const formSelectors = [
            `form[id*="product-form-template"][action*="/cart/add"][data-type="add-to-cart-form"]`,
            `form[id*="product-form-template"][action*="/cart/add"]`,
            `form[id*="product-form-template"][data-type="add-to-cart-form"]`,
            `form[action*="/cart/add"][data-type="add-to-cart-form"]`,
            `form[action*="/cart/add"]`,
            `form[data-type="add-to-cart-form"]`,
        ];
        const excludeKeywords = ['installment', 'installation'];

        let allForms = [];
        let excludeKeywordForms = [];
        let productIDFilteredForms = [];
        let variantIDFilteredForms = [];
        let variantIDElementFilteredForms = [];

        for (const selector of formSelectors) {
            allForms = origin.querySelectorAll(selector);
            if (allForms.length > 0) {
                break;
            }
        }

        excludeKeywordForms = Array.from(allForms).filter(form => {
            return !Array.from(form.attributes).some(attr =>
                excludeKeywords.some(keyword =>
                    attr.value.toLowerCase().includes(keyword)
                )
            );
        });

        productIDFilteredForms = Array.from(excludeKeywordForms).filter(form => form.innerHTML.includes(productId));
        variantIDFilteredForms = productIDFilteredForms.filter(form =>
            variantIds.some(variantId => form.innerHTML.includes(variantId))
        );
        // variantIDElementFilteredForms = variantIDFilteredForms.filter(form => {
        //     let variantInput = null;
        //     for (const key of LOOP_WIDGET_VARIANT_ID_SELECTORS) {
        //         if (!variantInput) {
        //             variantInput = form.querySelector(key);
        //         } else {
        //             break;
        //         }
        //     }
        //     if (variantInput && variantIds.includes(Number(variantInput.value))) {
        //         return true
        //     } else {
        //         return false;
        //     }
        // });


        if (variantIDElementFilteredForms.length > 0) {
            window.LOOP_WIDGET[productId]['loopWidgetProductForms'] = variantIDElementFilteredForms;
            return variantIDElementFilteredForms;
        } else if (variantIDFilteredForms.length > 0) {
            window.LOOP_WIDGET[productId]['loopWidgetProductForms'] = variantIDFilteredForms;
            return variantIDFilteredForms;
        } else if (productIDFilteredForms.length > 0) {
            window.LOOP_WIDGET[productId]['loopWidgetProductForms'] = productIDFilteredForms;
            return productIDFilteredForms;
        } else if (excludeKeywordForms.length > 0) {
            window.LOOP_WIDGET[productId]['loopWidgetProductForms'] = excludeKeywordForms;
            return excludeKeywordForms;
        } else {
            window.LOOP_WIDGET[productId]['loopWidgetProductForms'] = allForms;
            return allForms;
        }
    }

    function getLoopWidgetAddToCartButtons(productId) {
        if (window.LOOP_WIDGET[productId]['addToCartButtons']?.length) {
            return window.LOOP_WIDGET[productId]['addToCartButtons'];
        }

        const loopWidgetContainer = document.querySelector(`#loop-widget-container-id-${productId}`);
        let buttons = [];
        const selectors = [
            'button[type="submit"][name="add"]',
            'button[type="submit"]',
            'button[name="add"]',
            'button[data-add-to-cart], button[data-ajax-add-to-cart]'
        ];

        if (loopWidgetContainer) {
            let commonAncestor = loopWidgetContainer.parentNode;
            let suitableAncestorFound = false;

            while (commonAncestor && commonAncestor !== document.body && !suitableAncestorFound) {
                const forms = getLoopWidgetProductForms(productId, commonAncestor);
                forms.forEach((form) => {
                    selectors.some(selector => {
                        const foundButtons = form.querySelectorAll(selector);
                        if (foundButtons.length > 0) {
                            buttons = [...buttons, ...foundButtons];
                            suitableAncestorFound = true;
                            return true;
                        }
                        return false;
                    });
                });

                if (!suitableAncestorFound) {
                    commonAncestor = commonAncestor.parentNode;
                }
            }
        }

        if (buttons.length) {
            window.LOOP_WIDGET[productId]['addToCartButtons'] = buttons;
        }

        return buttons;
    }

    function getTargetAttributeValue(target, attributeName) {
        if (target && target.getAttribute(attributeName)) {
            return target.getAttribute(attributeName)
        }
        return null
    }

    function getLoopWidgetDiscount(productId, sellingPlan, variant) {
        const storeJson = window.LOOP_WIDGET[productId]['storeJson'];
        const { value_type, value } = sellingPlan.price_adjustments[0];
        const variantPrice = LOOP_WIDGET_USE_COMPARE_AT_PRICE ? (variant.compare_at_price || variant.price) : variant.price;
        const { deliveryFreq, isPrepaid } = getLoopWidgetPrepaidSellingPlanDeliveryFreq(productId, sellingPlan.id);
        let discount = 0;
        let discountText = '';

        if (storeJson?.presetBundleShopifyProductIds?.includes(productId)) {
            const bundlePrice = getLoopWidgetBundlePriceBySellingPlanId(productId, sellingPlan.id, false) || variantPrice;
            discount = Math.round(
                ((variantPrice - bundlePrice) / variantPrice) * 100
            );
            discountText = `${discount}%`;
            return { discount, discountText };
        }

        if (value_type === "price") {
            if (isPrepaid) {
                discount = ((variantPrice - (value / deliveryFreq)) / variantPrice) * 100;
                discount = Math.round(discount);
                discountText = `${discount}%`;
            } else {
                discount = variantPrice - value;
                discountText = `${loopWidgetFormatPrice(discount)}`;
            }
        } else if (value_type === "percentage") {
            discount = value;
            discountText = `${discount}%`;
        } else if (value_type === "fixed_amount") {
            discount = value;
            discountText = `${loopWidgetFormatPrice(discount)}`;
        }

        return { discount, discountText };
    }

    function loopWidgetFormatPrice(value) {
        const { locale, country } = window.Shopify;
        const { active: currency } = window.Shopify.currency;
        const decimalValue = value / 100;

        const options = {
            style: "currency",
            currency,
        };

        if (window.Shopify.shop === "rebuilt-performance.myshopify.com") {
            options.minimumFractionDigits = 0;
            options.maximumFractionDigits = 0;
        }

        const formattedLocale = locale?.includes("-") ? locale : `${locale}-${country}`;
        return new Intl.NumberFormat(formattedLocale, options).format(decimalValue);
    }

    function getStoreDefaultPlanFromPrepaidV2(plans) {
        return Object.entries(plans)
            .filter(([key, value]) => value.isDefault === true)
            .map(([key, value]) => Number(key));
    }

    function getStoreDefaultSellingPlanShopifyIds(productId) {
        if (window.LOOP_WIDGET[productId]['storeJson'].hasPrepaid) {
            return getStoreDefaultPlanFromPrepaidV2(window.LOOP_WIDGET[productId]['prepaidSellingPlans']);
        }
        return window.LOOP_WIDGET[productId]['storeJson'].storeDefaultSellingPlanShopifyIds ?? [];
    }

    function getVariantSellingPlanGroups(productId, variantId) {
        const storeJson = window.LOOP_WIDGET[productId]['storeJson'];
        const variantSellingPlanGroups = window.LOOP_WIDGET[productId]["variantToSellingPlanGroups"][variantId];
        const widgetSellingPlansToExclude = storeJson.shopifySellingPlanIdsToExcludeOnWidget ?? [];
        const countryFilteredSellingPlanShopifyIds = window.LOOP_WIDGET[productId]["countryFilteredSellingPlanShopifyIds"] || [];

        let sellingPlanGroups = window.LOOP_WIDGET[productId][
            "product"
        ].selling_plan_groups.filter(
            (g) => {
                if (variantSellingPlanGroups.includes(g.id) &&
                    g.app_id === LOOP_APP_ID) {
                    const sellingPlans = window.LOOP_WIDGET[productId]['sellingPlanGroupToSellingPlans'][g.id];
                    if (!loopWidgetHasCommonElements(sellingPlans, widgetSellingPlansToExclude)) {
                        return true;
                    }
                    return false;
                }
            }
        );
        if (storeJson?.preferences?.hideBundleSellingPlansOnProductPage && !storeJson.presetBundleShopifyProductIds.includes(productId)) {
            sellingPlanGroups = sellingPlanGroups.filter((spg) => {
                const sellingPlanGroupSellingPlans = window.LOOP_WIDGET[productId]['sellingPlanGroupToSellingPlans'][spg.id];
                const isBundleSellingPlanGroup = loopWidgetHasCommonElements(sellingPlanGroupSellingPlans, storeJson.bundleShopifySellingPlanIds);
                if (!isBundleSellingPlanGroup) {
                    return true;
                }
                return false;
            })
        }
        if (window.LOOP_WIDGET[productId].storeJson?.isSellingPlanCountryMappingEnabled) {
            sellingPlanGroups = sellingPlanGroups.filter((spg) => {
                const sellingPlansShopifyIds = window.LOOP_WIDGET[productId]['sellingPlanGroupToSellingPlans'][spg.id];
                if (loopWidgetHasCommonElements(sellingPlansShopifyIds, countryFilteredSellingPlanShopifyIds)) {
                    return true;
                }
                return false
            });
        }
        return sellingPlanGroups;
    }

    function isSelectedVariantAvailable(productId) {
        const storeJson = window.LOOP_WIDGET[productId]['storeJson'];
        if (storeJson.presetBundleShopifyProductIds.includes(productId)) {
            const selectedVariantId = getLoopWidgetVariantId(productId);
            const bundleVariant = getLoopWidgetBundleVariantInfo(productId, selectedVariantId);
            return !bundleVariant?.outOfStock ?? false;
        } else {
            const variant = getLoopWidgetVariantById(productId, getLoopWidgetVariantId(productId));
            return variant?.available ?? false;
        }
    }

    function loopWidgetGetQuantity(productId) {
        for (const selector of LOOP_WIDGET_PRODUCT_QUANTITY_SELECTORS) {
            const quantityEle = document.querySelector(selector);
            if (quantityEle) {
                return quantityEle.value || 1;
            }
        }
    }

    function loopWidgetGetVariantSpgSellingPlans(productId, sellingPlanGroupId) {
        const variantToSellingPlans = window.LOOP_WIDGET[productId].variantToSellingPlans;
        return variantToSellingPlans[getLoopWidgetVariantId(productId)][sellingPlanGroupId] ?? [];
    }

    function redirectToUrl(productId) {
        const redirectionUrl = window.LOOP_WIDGET[productId].productBundleData?.redirectionUrl;
        const defaultLocale = window.LOOP_WIDGET[productId]?.storeJson?.storeDefaultLocale;
        const currentLocale = getLocale();

        if (!redirectionUrl) {
            window.location.href = currentLocale === defaultLocale ? '/cart' : `/${currentLocale}${'/cart'}`;
            return;
        }

        if (redirectionUrl === 'None') {
            return;
        }

        if (redirectionUrl === "/cart" || redirectionUrl === "/checkout") {
            window.location.href = (currentLocale === defaultLocale || !defaultLocale) ? redirectionUrl : `/${currentLocale}${redirectionUrl}`;
        } else {
            window.location.href = redirectionUrl;
        }
    }

    async function dispatchLoopWidgetEvent(productId, eventName, response) {
        const addToCartEvent = new CustomEvent(eventName, {
            detail: { productId, response },
        });
        document.dispatchEvent(addToCartEvent);
    }

    // ***************** Mutation Observers and Event Listeners Setup ******************
    function observeLoopWidgetFormChangeForVariant(productId, variantIds, relevantForms) {
        relevantForms.forEach(form => {
            const observer = new MutationObserver(mutations => {
                mutations.forEach(mutation => {
                    if (mutation.type === 'attributes' && OBSERVER_ATTRIBUTE_NAMES.includes(mutation.attributeName)) {
                        let newValue = getTargetAttributeValue(mutation.target, mutation.attributeName);
                        if (newValue && variantIds.includes(Number(newValue))) {
                            handleLoopWidgetVariantIdChange(productId, newValue);
                        }
                    }
                });
            });

            const config = { attributes: true, childList: false, subtree: true, attributeFilter: OBSERVER_ATTRIBUTE_NAMES };
            observer.observe(form, config);
        });
    }

    function observeLoopWidgetVariantChange(productId) {
        const variantIds = window.LOOP_WIDGET[productId].product.variants.map(v => v.id);
        const relevantForms = getLoopWidgetProductForms(productId, document);
        if (relevantForms.length === 1) {
            let variantInput = null;
            for (const key of LOOP_WIDGET_VARIANT_ID_SELECTORS) {
                if (!variantInput) {
                    variantInput = relevantForms[0].querySelector(key);
                } else {
                    break;
                }
            }
            if (variantInput && variantIds.includes(Number(variantInput.value))) {
                window.LOOP_WIDGET[productId]['selectedVariantId'] = Number(variantInput.value);
            }
        }
        observeLoopWidgetFormChangeForVariant(productId, variantIds, relevantForms);
    }

    function listenLoopWidgetAddToCartCustomEvent() {
        document.addEventListener("loopPresetAddToCartSuccessEvent", function (event) {
            const { productId, response } = event.detail;
            widgetLogger(`Bundle: ${productId} added to cart.`);
        });
    }

    function getLoopWidgetPrepaidSellingPlanDeliveryFreq(productId, sellingPlanId) {
        const prepaidData = window.LOOP_WIDGET[productId]['prepaidSellingPlans'];
        const sellingPlanPrepaidInfo = prepaidData[sellingPlanId];
        return { deliveryFreq: sellingPlanPrepaidInfo?.deliveriesPerBillingCycle ?? 1, isPrepaid: sellingPlanPrepaidInfo?.isPrepaidV2 };
    }

    function getPreviousSpgSelectedForVariant(productId, variantSellingPlanGroups = []) {
        const spgIds = variantSellingPlanGroups.map(spg => spg.id);
        if (window.LOOP_WIDGET[productId].selectedSellingPlanGroupId && spgIds.includes(window.LOOP_WIDGET[productId].selectedSellingPlanGroupId)) {
            return window.LOOP_WIDGET[productId].selectedSellingPlanGroupId;
        } else if (window.LOOP_WIDGET[productId].selectedSellingPlanGroupId) {
            return spgIds[0];
        }
        return null;
    }

    function changeDropdownValueBySelectId(selectId, value) {
        if (selectId && value) {
            const selectElement = document.getElementById(selectId);
            if (selectElement) {
                selectElement.value = `${value}`;
            }
        }
    }

    // ***************** Widget Show/Hide and Skeleton Loading ******************
    function hideLoopWidgetLoader(productId) {
        const productSkeletonLoaders = document.querySelectorAll(`#loop-widget-skeleton-container-id-${productId}.loop-widget-skeleton-container`);
        productSkeletonLoaders.forEach((skeletonLoader) => {
            if (skeletonLoader) {
                skeletonLoader.classList.add("loop-display-none");
            }
        });
    }

    function hideLoopWidget(productId, sourceFunction, message = "") {
        widgetLogger("Hiding widget from: ", sourceFunction, message);
        const widgetContainer = document.getElementById(`loop-widget-container-id-${productId}`);
        if (widgetContainer) {
            widgetContainer.classList.add("loop-display-none");
        }
    }

    function showLoopWidget(productId) {
        document.getElementById(`loop-widget-container-id-${productId}`).classList.remove("loop-display-none");
    }

    function handleLoopWidgetSkeletonLoader(productId) {
        hideLoopWidgetLoader(productId);
        const requires_selling_plan = window.LOOP_WIDGET[productId].product.requires_selling_plan;
        const variantSellingPlanGroups = getVariantSellingPlanGroups(productId, getLoopWidgetVariantId(productId));
        if (variantSellingPlanGroups.length) {
            dispatchLoopWidgetEvent(productId, "loopWidgetLoaded", {});
            if (requires_selling_plan && getLoopWidgetPreferenceByKey(productId, "hideWidgetIfOnePlanAvailable") && (variantSellingPlanGroups.length === 1 || (getLoopWidgetPreferenceByKey(productId, "layoutType") === "CHECKBOX"))) {
                hideLoopWidget(productId, "handleLoopWidgetSkeletonLoader", "hideWidgetIfOnePlanAvailable and selling plan groups length is 1");
            } else {
                showLoopWidget(productId);
            }
        } else {
            hideLoopWidget(productId, "handleLoopWidgetSkeletonLoader", "No selling plan groups found");
            hideLoopWidgetLoader(productId);
        }
        if (getLoopWidgetPreferenceByKey(productId, "alwaysShowSellingPlanDetails")) {
            document.documentElement.style.setProperty("--loop-widget-always-show-details-height", "500px");
        }
    }

    function hideOneTimePurchaseOptionLoopWidget(productId) {
        const onetimePurchaseOption = document.getElementById(`loop-widget-container-id-${productId}`)?.querySelector(`.loop-widget-purchase-option-onetime`);
        const onetimePurchaseOptionBtnGroup = document.getElementById(`loop-widget-container-id-${productId}`)?.querySelector(`.loop-w-btn-group-purchase-option-onetime`);
        if (onetimePurchaseOption) {
            onetimePurchaseOption.classList.add("loop-display-none");
        }
        if (onetimePurchaseOptionBtnGroup) {
            onetimePurchaseOptionBtnGroup.classList.add("loop-display-none");
        }
    }

    // ***************** Add to Cart Button Handlers ******************
    function loopWidgetUpdateAddToCartButtonText(productId) {
        const buttons = getLoopWidgetAddToCartButtons(productId);
        const isAvailable = isSelectedVariantAvailable(productId);
        const isSubscriptionSelected = window.LOOP_WIDGET[productId]['selectedSellingPlanId'];
        const buttonText = isAvailable ? (isSubscriptionSelected ? getLoopWidgetTextsByKey(productId, "addSubscriptionToCartButtonText") : getLoopWidgetTextsByKey(productId, "addToCartButtonText")) : getLoopWidgetTextsByKey(productId, "outOfStockText");
        buttons.forEach(button => {
            updateButtonInnerHTMLLoopWidget(button, buttonText);
        })
    }

    function updateButtonInnerHTMLLoopWidget(button, text) {
        if (button.firstElementChild) {
            button.firstElementChild.innerHTML = text;
        } else {
            button.innerHTML = text;
        }
    }

    function disableAddToCartBtnLoopWidget(productId) {
        getLoopWidgetAddToCartButtons(productId).forEach((btn) => {
            btn.disabled = true;
        });
    }

    function enableAddToCartBtnLoopWidget(productId) {
        getLoopWidgetAddToCartButtons(productId).forEach((btn) => {
            btn.disabled = false;
        });
    }

    function loopWidgetOverrideAddToCartButton(productId) {
        getLoopWidgetAddToCartButtons(productId).forEach((btn) => {
            btn = loopWidgetRemoveAllEventListenersForEle(btn);
            btn.addEventListener("click", (event) => {
                const quantity = loopWidgetGetQuantity(productId);
                loopWidgetHandleAddToCartEvent(event, productId, quantity);
            });
        });
        window.LOOP_WIDGET[productId]['addToCartButtons'] = [];
    }

    function loopWidgetRemoveAllEventListenersForEle(element) {
        const clone = element.cloneNode(true);
        element.parentNode.replaceChild(clone, element);
        return clone;
    }

    async function loopWidgetHandleAddToCartEvent(event, productId, quantity = 1) {
        event.preventDefault();
        event.stopPropagation();
        disableAddToCartBtnLoopWidget(productId);

        const bundleVariant = getLoopWidgetBundleVariantInfo(productId, getLoopWidgetVariantId(productId));
        if (!bundleVariant || bundleVariant.outOfStock) {
            return;
        }

        const productBundleData = getLoopWidgetProductBundleData(productId);
        const selectedSellingPlanId = window.LOOP_WIDGET[productId].selectedSellingPlanId;

        const { bundleTransactionId, bundleVariantDiscount } = await handleBundleTransactionLoopWidget(productId, quantity, selectedSellingPlanId);
        if (!bundleTransactionId) {
            return;
        }

        const payload = await loopWidgetCreateAddToCartPayload(
            productId,
            bundleTransactionId,
            bundleVariantDiscount,
            selectedSellingPlanId,
            getLoopWidgetVariantId(productId),
            quantity,
            productBundleData
        );
        await shopifyAddToCartByLoopWidget(payload, productId);
    }

    async function shopifyAddToCartByLoopWidget(payload, productId) {
        const endpoint = `${window.Shopify.routes.root}cart/add.js`;
        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await response.json();
            enableAddToCartBtnLoopWidget(productId);
            redirectToUrl(productId)
            await dispatchLoopWidgetEvent(productId, "loopPresetAddToCartSuccessEvent", data);
        } catch (error) {
            widgetLogger("shopifyAddToCartByLoopWidget", error);
            enableAddToCartBtnLoopWidget(productId);
        }
    }

    // ***************** Bundle Related Functions ******************
    async function loopWidgetProcessBundleProduct(productId) {
        const storeJSON = window.LOOP_WIDGET[productId].storeJson;
        if (!storeJSON.hasPresetBundles || !storeJSON.presetBundleShopifyProductIds.includes(productId)) {
            return;
        }
        const productBundleData = getLoopWidgetProductBundleData(productId);
        if (productBundleData && productBundleData.variants.length) {
            loopWidgetOverrideAddToCartButton(productId);
            handleLoopBundleWidgetVisibility(productId);
            loopWidgetCheckAllowCheckoutIfBundle(productId);
        }
    }

    function getLoopWidgetProductBundleData(productId) {
        return window.LOOP_WIDGET[productId]?.productBundleData ?? {};
    }

    function getLoopWidgetBundleVariantInfo(productId, variantId) {
        const productBundleData = getLoopWidgetProductBundleData(productId);
        return productBundleData?.variants?.find(v => v.shopifyId === variantId);
    }

    function getLoopWidgetBundlePriceBySellingPlanId(productId, sellingPlanId, isOneTime) {
        const selectedVariantId = getLoopWidgetVariantId(productId);
        const bundleVariant = getLoopWidgetBundleVariantInfo(productId, selectedVariantId);
        const variant = getLoopWidgetVariantById(productId, selectedVariantId);
        if (!variant || !bundleVariant) return 0;

        const conversionRate = window.Shopify.currency.rate;
        const bundleDiscountedPriceOnetime = bundleVariant.oneTimePrice * 100 * conversionRate;
        const bundleDiscountedPriceSubscription = bundleVariant.sellingPlanPrices[sellingPlanId] * 100 * conversionRate;

        return isOneTime ? bundleDiscountedPriceOnetime : bundleDiscountedPriceSubscription;
    }

    function handleLoopBundleWidgetVisibility(productId) {
        const purchaseType = getLoopWidgetProductBundleData(productId).purchaseType;
        if (purchaseType === "SUBSCRIPTION") {
            hideOneTimePurchaseOptionLoopWidget(productId);
        } else if (purchaseType === "ONETIME") {
            hideLoopWidget(productId, "handleLoopBundleWidgetVisibility", "Bundle is one time available only");
        }
    }

    function loopWidgetCheckAllowCheckoutIfBundle(productId) {
        enableAddToCartBtnLoopWidget(productId);
        const selectedVariantId = getLoopWidgetVariantId(productId);
        const selectedVariant = getLoopWidgetBundleVariantInfo(productId, selectedVariantId);

        if (selectedVariant?.outOfStock) {
            const buttonText = getLoopWidgetTextsByKey(productId, "outOfStockText");
            const addToCartButtons = getLoopWidgetAddToCartButtons(productId);
            if (addToCartButtons.length) {
                addToCartButtons.forEach(addToCartButton => {
                    setTimeout(() => updateButtonInnerHTMLLoopWidget(addToCartButton, buttonText), 500);
                });
            }
            disableAddToCartBtnLoopWidget(productId);
        }
    }

    async function loopWidgetCreateBundleTransaction(productId, payload) {
        try {
            const authorization = window.LOOP_WIDGET[productId].storeJson.sentinalAuthToken;
            const response = await fetch(`${window.LOOP_WIDGET[productId].storeJson.apiUrl.bundleTransaction}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "authorization": authorization },
                body: JSON.stringify(payload),
            });
            const responseJson = await response.json();
            return responseJson.data.transactionId;
        } catch (error) {
            widgetLogger("loopWidgetCreateBundleTransaction", error);
            throw error;
        }
    }

    function loopWidgetCreateBundleTransactionPayload(productId, quantity, selectedSellingPlanId) {
        const selectedVariantId = getLoopWidgetVariantId(productId);
        const bundleVariant = getLoopWidgetBundleVariantInfo(productId, selectedVariantId);
        if (!bundleVariant) return { payload: null, bundleVariantDiscount: null };

        const discount = selectedSellingPlanId
            ? bundleVariant.mappedDiscounts.find(d => d.purchaseType === "SUBSCRIPTION")
            : bundleVariant.mappedDiscounts.find(d => d.purchaseType !== "SUBSCRIPTION");

        if (!discount) return { payload: null, bundleVariantDiscount: null };

        return {
            payload: {
                presetProductShopifyId: Number(productId),
                presetDiscountId: discount.id,
                presetVariantShopifyId: Number(selectedVariantId),
                totalQuantity: Number(quantity),
                sellingPlanShopifyId: Number(selectedSellingPlanId),
            },
            bundleVariantDiscount: discount,
        };
    }

    async function handleBundleTransactionLoopWidget(productId, quantity, selectedSellingPlanId) {
        try {
            const { payload, bundleVariantDiscount } = loopWidgetCreateBundleTransactionPayload(productId, quantity, selectedSellingPlanId);
            if (!payload) return { bundleTransactionId: null, bundleVariantDiscount: null };

            const bundleTransactionId = await loopWidgetCreateBundleTransaction(productId, payload);
            if (!bundleTransactionId) enableAddToCartBtnLoopWidget(productId);
            return { bundleTransactionId, bundleVariantDiscount };
        } catch (error) {
            enableAddToCartBtnLoopWidget(productId);
            widgetLogger("handleBundleTransactionLoopWidget", error);
            return { bundleTransactionId: null, bundleVariantDiscount: null };
        }
    }

    async function getLoopWidgetBundleDiscountAttributes() {
        try {
            const url = `https://${window.Shopify.cdnHost.split("/cdn")[0]}/cart.json`;
            const res = await (await fetch(url)).json();
            const loopBundleDiscountAttributes = res.attributes?._loopBundleDiscountAttributes
                ? JSON.parse(res.attributes._loopBundleDiscountAttributes)
                : {};

            const bundleIdsInCart = new Set(res.items.map(item => (item.properties?._bundleId || item.properties?._loopBundleTxnId)).filter(Boolean));

            return Object.keys(loopBundleDiscountAttributes)
                .filter(key => bundleIdsInCart.has(key))
                .reduce((obj, key) => {
                    obj[key] = loopBundleDiscountAttributes[key];
                    return obj;
                }, {});
        } catch (error) {
            widgetLogger("getLoopWidgetBundleDiscountAttributes", error);
            return {};
        }
    }

    async function loopWidgetCreateAddToCartPayload(productId, bundleTransactionId, bundleVariantDiscount, selectedSellingPlanId, selectedBundleVariantId, quantity, productBundleData) {
        const formData = {
            items: [],
            attributes: {
                _loopBundleDiscountAttributes: {},
            },
        };

        const oldAttr = await getLoopWidgetBundleDiscountAttributes();
        const currentDiscountAttribute = {
            [bundleTransactionId]: {
                discountType: bundleVariantDiscount.type,
                discountValue: bundleVariantDiscount.value,
                discountComputedValue: bundleVariantDiscount
                    ? selectedSellingPlanId
                        ? bundleVariantDiscount.sellingPlanComputedDiscounts[selectedSellingPlanId] * (window.LOOP_WIDGET[productId].storeJson?.preferences?.presetDummySkuEnabled ? 1 : quantity)
                        : bundleVariantDiscount.oneTimeDiscount * (window.LOOP_WIDGET[productId].storeJson?.preferences?.presetDummySkuEnabled ? 1 : quantity)
                    : 0,
            },
        };

        formData.attributes._loopBundleDiscountAttributes = JSON.stringify({
            ...oldAttr,
            ...currentDiscountAttribute,
        });

        const selectedBundleVariant = getLoopWidgetBundleVariantInfo(productId, selectedBundleVariantId);
        const selectedBundleVariantProducts = selectedBundleVariant?.mappedProductVariants ?? [];

        if (window.LOOP_WIDGET[productId].storeJson?.preferences?.presetDummySkuEnabled) {
            const obj = {
                id: getLoopWidgetVariantId(productId),
                quantity: quantity,
                selling_plan: selectedSellingPlanId,
                properties: {
                    _loopBundleTxnId: bundleTransactionId,
                    _isPresetBundleProduct: true,
                    ...(window.LOOP_WIDGET[productId].storeJson.preferences.showBundleName ? { bundleName: productBundleData.name ?? "" } : { _bundleName: productBundleData.name ?? "" }),
                },
            };
            formData.items.push(obj);
        } else {
            if (selectedBundleVariantProducts.length) {
                selectedBundleVariantProducts.forEach(childProduct => {
                    const obj = {
                        id: childProduct.shopifyId,
                        quantity: childProduct.quantity * quantity,
                        selling_plan: selectedSellingPlanId,
                        properties: {
                            _bundleId: bundleTransactionId,
                            _isPresetBundleProduct: true,
                            ...(window.LOOP_WIDGET[productId].storeJson.preferences.showBundleName ? { bundleName: productBundleData.name ?? "" } : { _bundleName: productBundleData.name ?? "" }),
                        },
                    };
                    formData.items.push(obj);
                });
            }
        }

        return formData;
    }

    // ***************** Variant and Selling Plan State Handlers ******************
    function handleLoopWidgetVariantIdChange(productId, variantId) {
        const themeId = window?.Shopify?.theme?.id;
        const storeJson = window.LOOP_WIDGET[productId]['storeJson'];
        const templateName = window.LOOP_WIDGET[productId]?.templateName || 'default';
        const widgetId = storeJson?.widgetMapping?.[themeId]?.[templateName];
        if (!widgetId) {
            widgetLogger("No theme mapping found for the template");
            return;
        }

        widgetLogger("VariantId changed: ", variantId);
        window.LOOP_WIDGET[productId]['selectedVariantId'] = Number(variantId);
        renderLoopWidgetContainer(productId);
        handleLoopBundleWidgetVisibility(productId);
        loopWidgetCheckAllowCheckoutIfBundle(productId);
        handleLoopWidgetSkeletonLoader(productId);
    }

    function handleLoopWidgetSellingPlanValue(productId, selectedSellingPlanId, toAdd) {
        const forms = getLoopWidgetProductForms(productId, document);
        if (!forms.length) return;

        window.LOOP_WIDGET[productId]['selectedSellingPlanId'] = selectedSellingPlanId;
        forms.forEach((form) => {
            let sellingPlanInput = form.querySelector(LOOP_WIDGET_SELLING_PLAN_SELECTOR);
            if (!sellingPlanInput) {
                sellingPlanInput = document.createElement('input');
                sellingPlanInput.type = 'hidden';
                sellingPlanInput.name = 'selling_plan';
                form.appendChild(sellingPlanInput);
            }
            if (toAdd) {
                sellingPlanInput.value = selectedSellingPlanId;
            } else if (sellingPlanInput) {
                sellingPlanInput.value = '';
            }
        })
    }

    function renderLoopWidgetContainer(productId) {
        if (getLoopWidgetPreferenceByKey(productId, "layoutType") === "CHECKBOX") {
            const buttonGroup = new CheckboxLayout(productId);
            buttonGroup.initCheckboxLayout(productId);
        } else if (getLoopWidgetPreferenceByKey(productId, "layoutType") === "BUTTON_GROUP") {
            const buttonGroup = new ButtonGroupLayout(productId);
            buttonGroup.initButtonLayout(productId);
        } else {
            const radioGroup = new RadioGroupLayout(productId);
            radioGroup.initRadioLayout(productId);
        }
    }

    // RADIO_GROUP layout
    class RadioGroupLayout {
        constructor(productId) {
            this.productId = productId;
        }

        // ***************** Main Widget Generation (Entry Points) *****************
        initRadioLayout(productId) {
            const variantId = getLoopWidgetVariantId(productId);
            this.generateLoopWidget(productId, variantId);
            this.selectLoopWidgetPurchaseOption(productId);
            this.setSvgDimensions(productId);
            this.updateLoopWidgetDropdownArrowSVG(productId);
            this.attachEventListeners();
        }

        generateLoopWidget(productId, variantId) {
            const loopWidgetContainer = document.getElementById(`loop-widget-container-id-${productId}`);
            if (!loopWidgetContainer) return;

            const requires_selling_plan = window.LOOP_WIDGET[productId].product.requires_selling_plan;
            const availableSellingPlanGroups = getVariantSellingPlanGroups(productId, variantId);
            if (requires_selling_plan && getLoopWidgetPreferenceByKey(productId, "hideWidgetIfOnePlanAvailable") && availableSellingPlanGroups.length === 1) {
                hideLoopWidget(productId, "generateLoopWidget", "hideWidgetIfOnePlanAvailable and selling plan groups length is 1");
            }

            loopWidgetContainer.innerHTML = `
                ${this.generateLoopWidgetPurchaseOptionsLabel(productId)}
                ${this.generateLoopWidgetPurchaseOptions(productId, variantId)}
                ${this.generateLoopWidgetTooltip(productId)}
            `;
        }

        generateLoopWidgetPurchaseOptions(productId, variantId) {
            return `
            <div class="loop-widget-purchase-options-container">
                ${getLoopWidgetPreferenceByKey(productId, "purchaseOptionsOrder") === "Display one-time purchase first" ? this.generateLoopWidgetOnetimeContainer(productId, variantId) : ''}
                ${this.generateLoopWidgetSellingPlanContainer(productId, variantId)}
                ${getLoopWidgetPreferenceByKey(productId, "purchaseOptionsOrder") !== "Display one-time purchase first" ? this.generateLoopWidgetOnetimeContainer(productId, variantId) : ''}
            </div>`;
        }

        // ***************** Container Generation (High-level HTML) ******************
        generateLoopWidgetPurchaseOptionsLabel(productId) {
            return getLoopWidgetPreferenceByKey(productId, "showPurchaseOptionsLabel") ? `<div class="loop-widget-purchase-options-label">${getLoopWidgetTextsByKey(productId, "purchaseOptionLabel")}</div>` : '';
        }

        generateLoopWidgetSellingPlanContainer(productId, variantId) {
            const requires_selling_plan = window.LOOP_WIDGET[productId].product.requires_selling_plan;
            let availableSellingPlanGroups = getVariantSellingPlanGroups(productId, variantId);
            if (availableSellingPlanGroups.length === 0) {
                hideLoopWidget(productId, "generateLoopWidgetSellingPlanContainer", "availableSellingPlanGroups length is 0");
            } else {
                if (requires_selling_plan && getLoopWidgetPreferenceByKey(productId, "hideWidgetIfOnePlanAvailable") && availableSellingPlanGroups.length === 1) {
                    hideLoopWidget(productId, "generateLoopWidgetSellingPlanContainer", "hideWidgetIfOnePlanAvailable and selling plan groups length is 1");
                } else {
                    showLoopWidget(productId);
                }
            }

            return this.getSellingPlanContainerTemplate(productId, availableSellingPlanGroups);
        }

        generateLoopWidgetOnetimeContainer(productId, variantId) {
            const onetimeContainerClass = [
                "loop-widget-purchase-option",
                getLoopWidgetPreferenceByKey(productId, "purchaseOptionsOrder") !== "Display one-time purchase first" && "loop-widget-purchase-option-border-top",
                "loop-widget-purchase-option-onetime"
            ].filter(Boolean).join(" ");
            const variant = getLoopWidgetVariantById(productId, variantId);
            const variantSellingPlanGroups = getVariantSellingPlanGroups(productId, getLoopWidgetVariantId(productId));
            const requires_selling_plan = window.LOOP_WIDGET[productId].product.requires_selling_plan;

            const radioContainer = variantSellingPlanGroups.length === 1 && requires_selling_plan
                ? ''
                : `<div id="loop-widget-onetime-purchase-option-radio-id-${productId}" class="loop-widget-purchase-option-radio">
                    ${this.getLoopWidgetSvgRadio()}
                </div>`;

            return this.generateOnetimeContainer(productId, variant, onetimeContainerClass, radioContainer);
        }

        getSellingPlanContainerTemplate(productId, availableSellingPlanGroups) {
            return availableSellingPlanGroups.map(sellingPlanGroup => `
            <div data-loop-widget-selling-plan-group data-selling-plan-group-id=${sellingPlanGroup.id} data-loop-widget-purchase-option id="loop-widget-purchase-option-id-${sellingPlanGroup.id}" class="loop-widget-purchase-option">
                <div class="loop-widget-purchase-option-header">
                    <div class="loop-widget-spg-label-discount-wrapper">
                        ${this.generateLoopWidgetRadioInput(productId, sellingPlanGroup.id, availableSellingPlanGroups.length)}
                        ${this.generateLoopWidgetLabel(sellingPlanGroup.id, sellingPlanGroup.name)}
                        ${this.generateLoopWidgetPurchaseOptionDiscountBadge(productId, sellingPlanGroup.id)}
                    </div>
                    ${this.generateLoopWidgetPurchaseOptionPriceContainer(productId, sellingPlanGroup.id)}
                </div>
                ${sellingPlanGroup.selling_plans.length > 0 ? this.generateLoopWidgetSellingPlanSelector(productId, sellingPlanGroup, sellingPlanGroup.id, sellingPlanGroup.selling_plans) : ''}
            </div>`).join(" ");
        }

        generateOnetimeContainer(productId, variant, onetimeContainerClass, radioContainer) {
            return `
            <div data-loop-widget-onetime-purchase-option data-loop-widget-purchase-option class="${onetimeContainerClass}">
                <div class="loop-widget-purchase-option-header">
                    <div class="loop-widget-spg-label-discount-wrapper">
                        ${radioContainer}
                        <label for="loop-widget-onetime-purchase-option-radio-id-${productId}" class="loop-widget-purchase-option-label">${getLoopWidgetTextsByKey(productId, "oneTimePurchaseLabel")}</label>
                        <div id="loop-widget-onetime-purchase-option-discount-badge-id-${productId}" class="loop-widget-purchase-option-discount-badge loop-display-none"></div>
                    </div>
                    ${this.generateLoopWidgetVariantPriceTemplateOnetime(productId, variant)}
                </div>
                ${getLoopWidgetTextsByKey(productId, "oneTimeDescriptionText") ?
                    `<div class="loop-widget-sp-selector-description-wrapper loop-widget-purchase-option-description-container loop-widget-spg-container">
                        <div class="loop-widget-onetime-purchase-option-description-text">${getLoopWidgetTextsByKey(productId, "oneTimeDescriptionText")}</div>
                    </div>`: ''
                }
            </div>`
        }

        // ***************** Selling Plan HTML Generation ******************
        generateLoopWidgetSellingPlanSelector(productId, sellingPlanGroup, sellingPlanGroupId, selling_plans) {
            const variantSellingPlans = loopWidgetGetVariantSpgSellingPlans(productId, sellingPlanGroupId);
            const filteredSPforVariant = selling_plans.filter(sp => variantSellingPlans.includes(sp.id));
            const requires_selling_plan = window.LOOP_WIDGET[productId].product.requires_selling_plan;
            const variantSellingPlanGroups = getVariantSellingPlanGroups(productId, getLoopWidgetVariantId(productId));
            const shouldRemoveMargin = variantSellingPlanGroups.length === 1 && requires_selling_plan;

            return this.generateLoopWidgetSpSelectorTemplate(productId, sellingPlanGroup, sellingPlanGroupId, shouldRemoveMargin, filteredSPforVariant);
        }

        generateLoopWidgetPlanSelector(productId, sellingPlanGroup, sellingPlanGroupId, selling_plans) {
            const label = sellingPlanGroup?.options?.[0]?.name ?? "";

            if (getLoopWidgetPreferenceByKey(productId, "showPlanSelectorAsTextIfOnePlanAvailable") && selling_plans.length === 1) {
                return this.generateSpSelectorAsText(selling_plans, label, getLoopWidgetPreferenceByKey(productId, "sellingPlanFrequencyOptions") === "BUTTON");
            }

            if (selling_plans.length === 1) {
                return '';
            }

            if (getLoopWidgetPreferenceByKey(productId, "sellingPlanFrequencyOptions") === "BUTTON") {
                return this.generateLoopWidgetPlanSelectorButton(productId, sellingPlanGroupId, selling_plans, label);
            }

            return this.generateSpSelectorAsDropdown(productId, sellingPlanGroupId, selling_plans, label);
        }

        generateLoopWidgetSpSelectorTemplate(productId, sellingPlanGroup, sellingPlanGroupId, shouldRemoveMargin, filteredSPforVariant) {
            const description = filteredSPforVariant[0]?.description || "";

            return `
            <div id="loop-widget-spg-container-id-${sellingPlanGroupId}" class="${shouldRemoveMargin ? "loop-widget-spg-container loop-widget-left-margin-0" : "loop-widget-spg-container"}">
                ${this.generateLoopWidgetPlanSelector(productId, sellingPlanGroup, sellingPlanGroupId, filteredSPforVariant)}
                ${description ? this.generateLoopWidgetSellingPlanDescription(sellingPlanGroupId, description) : ''}
            </div>`
        }

        generateLoopWidgetPlanSelectorButton(productId, sellingPlanGroupId, selling_plans, label) {
            return `<div class="loop-widget-sp-button-selector-wrapper">
            <div class="loop-widget-sp-button-selector-label">${label}</div>
            <div id="loop-widget-sp-button-group-id-${sellingPlanGroupId}" class="loop-widget-sp-button-container">
                ${selling_plans.map(sp => this.generateLoopWidgetSellingPlanButton(sp, sellingPlanGroupId)).join('')}
            </div>
        </div>`
        }

        generateSpSelectorAsDropdown(productId, sellingPlanGroupId, selling_plans, label) {
            return `
          <div class="loop-widget-sp-selector-wrapper">
            <label class="loop-widget-sp-selector-label">${label}</label>
            <div class="loop-widget-sp-selector-container">
              <select id="loop-widget-sp-selector-dropdown-${sellingPlanGroupId}" data-selling-plan-group-id=${sellingPlanGroupId} class="loop-widget-sp-selector" name="selling_plan">
                ${selling_plans.map(this.generateLoopWidgetSellingPlan).join('')}
              </select>
            </div>
          </div>`;
        }

        generateSpSelectorAsText(selling_plans, label, isBtnLabel) {
            const classNames = `loop-widget-sp-selector-label-as-text loop-widget-left-padding-0${isBtnLabel ? " loop-widget-sp-selector-btn-label-as-text" : ""}`;
            return `<div class="loop-widget-sp-selector-wrapper">
                <div class="${classNames}"><span class="loop-widget-sp-selector-as-text-label">${label}: </span><span class="loop-widget-sp-option">${selling_plans[0].name}</span></div>
            </div>`
        }

        generateLoopWidgetSellingPlan(sp) {
            return `<option class="loop-widget-sp-option" value="${sp.id}">${sp.options[0].value ?? sp.name}</option>`;
        }

        generateLoopWidgetSellingPlanButton(sp, sellingPlanGroupId) {
            return `<div id="loop-widget-sp-button-id-${sp.id}" data-selling-plan-group-id=${sellingPlanGroupId} data-selling-plan-id=${sp.id} class="loop-widget-sp-button">
               ${sp.options[0].value ?? sp.name}
        </div>`;
        }

        generateLoopWidgetSellingPlanDescription(sellingPlanGroupId, description) {
            return `
            <div class="loop-widget-sp-selector-description-wrapper">
                <div id="loop-widget-sp-selector-description-id-${sellingPlanGroupId}" class="loop-widget-sp-selector-description">${description}</div>
            </div>`;
        }

        // ******************** Price & Discount HTML Generation ******************
        generateLoopWidgetPurchaseOptionPriceContainer(productId, sellingPlanGroupId) {
            const storeJson = window.LOOP_WIDGET[productId]['storeJson'];
            const variant = getLoopWidgetVariantById(productId, getLoopWidgetVariantId(productId));
            const sellingPlans = loopWidgetGetVariantSpgSellingPlans(productId, sellingPlanGroupId);
            const sellingPlan = variant.selling_plan_allocations.find(a => a.selling_plan_id === sellingPlans[0]);
            const { deliveryFreq, isPrepaid } = getLoopWidgetPrepaidSellingPlanDeliveryFreq(productId, sellingPlan.selling_plan_id);
            const originalPrice = LOOP_WIDGET_USE_COMPARE_AT_PRICE ? variant.compare_at_price : variant.price;
            const price = storeJson.presetBundleShopifyProductIds.includes(productId) ? getLoopWidgetBundlePriceBySellingPlanId(productId, sellingPlan.selling_plan_id, false) || sellingPlan.price / deliveryFreq : sellingPlan.price / deliveryFreq;
            const totalPrepaidPrice = sellingPlan.price;
            return this.getPurchaseOptionPriceTemplate(productId, sellingPlanGroupId, originalPrice, price, totalPrepaidPrice, deliveryFreq, isPrepaid);
        }

        getPurchaseOptionPriceTemplate(productId, sellingPlanGroupId, originalPrice, price, totalPrepaidPrice, deliveryFreq, isPrepaid) {
            return `
            <div class="loop-widget-purchase-option-price-each-container">
                <div class="loop-widget-purchase-option-price-container">
                    ${originalPrice === price || !getLoopWidgetPreferenceByKey(productId, "showCompareAtPrice") ? '' : `<div class="loop-widget-purchase-option-compare-at-price">${loopWidgetFormatPrice(originalPrice)}</div>`}
                    <div id="loop-widget-purchase-option-price-id-${sellingPlanGroupId}" class="loop-widget-purchase-option-price">${loopWidgetFormatPrice(price)}</div>
                </div>
                ${this.getPrepaidPriceOrEachText(productId, isPrepaid, deliveryFreq, totalPrepaidPrice, sellingPlanGroupId)}
            </div>`
        }

        generateLoopWidgetVariantPriceTemplateOnetime(productId, variant) {
            const storeJson = window.LOOP_WIDGET[productId]['storeJson'];
            const originalPrice = storeJson.presetBundleShopifyProductIds.includes(productId) ? variant.price : variant.compare_at_price;
            const price = storeJson.presetBundleShopifyProductIds.includes(productId) ? getLoopWidgetBundlePriceBySellingPlanId(productId, null, true) || (variant.price || variant.compare_at_price) : (variant.price || variant.compare_at_price);
            return this.getVariantPriceTemplate(productId, originalPrice, price);
        }

        getVariantPriceTemplate(productId, originalPrice, price) {
            return `
            <div class="loop-widget-purchase-option-price-each-container">
                <div class="loop-widget-purchase-option-price-container">
                ${getLoopWidgetPreferenceByKey(productId, "showCompareAtPrice") ? `<div class="loop-widget-purchase-option-compare-at-price loop-display-none">${loopWidgetFormatPrice(originalPrice)}</div>` : ''}
                <div id="loop-widget-purchase-option-price-onetime-${productId}" class="loop-widget-purchase-option-price">${loopWidgetFormatPrice(price)}</div>
                </div>
                ${!getLoopWidgetPreferenceByKey(productId, "hideEachLabel") ? `<div class="loop-widget-purchase-option-each-label">${getLoopWidgetTextsByKey(productId, "priceLabelText")}</div>` : ''}
            </div>`
        }

        generateLoopWidgetPurchaseOptionDiscountBadge(productId, sellingPlanGroupId) {
            const variant = getLoopWidgetVariantById(productId, getLoopWidgetVariantId(productId));
            const variantSellingPlans = loopWidgetGetVariantSpgSellingPlans(productId, sellingPlanGroupId);
            const firstSellingPlan = window.LOOP_WIDGET[productId]['product'].selling_plan_groups.find(g => g.id === sellingPlanGroupId)['selling_plans'].find(sp => sp.id === variantSellingPlans[0]);
            const { discount, discountText } = getLoopWidgetDiscount(productId, firstSellingPlan, variant);
            const discText = getLoopWidgetTextsByKey(productId, "discountBadgeText")?.replace("{{discount_value}}", `${discountText}`);
            return getLoopWidgetPreferenceByKey(productId, "showDiscountBadgeForSubscription") ? `<div id="loop-widget-purchase-option-discount-badge-id-${sellingPlanGroupId}" class="loop-widget-purchase-option-discount-badge${discount > 0 ? '' : ' loop-display-none'}">${discText}</div>` : '';
        }

        getPrepaidPriceOrEachText(productId, isPrepaid, deliveryFreq, totalPrepaidPrice, sellingPlanGroupId) {
            if (isPrepaid && getLoopWidgetPreferenceByKey(productId, "showFullPriceForPrepaidPlans")) {
                return `<div id="loop-widget-purchase-option-total-prepaid-price-id-${sellingPlanGroupId}" class="loop-widget-purchase-option-total-prepaid-price">${getLoopWidgetTextsByKey(productId, "prepaidFullPriceText").replace("{{prepaid_price}}", loopWidgetFormatPrice(totalPrepaidPrice)).replace("{{deliveries_per_charge}}", deliveryFreq)}</div>`
            }

            return `${!getLoopWidgetPreferenceByKey(productId, "hideEachLabel") ? `<div class="loop-widget-purchase-option-each-label">${getLoopWidgetTextsByKey(productId, "priceLabelText")}</div>` : ''}`
        }

        // ********************* UI Components & SVG Generation ******************
        generateLoopWidgetLabel(id, name) {
            return `<label for="loop-widget-purchase-option-radio-id-${id}" class="loop-widget-purchase-option-label">${name}</label>`;
        }

        getLoopWidgetSvgRadio() {
            return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="loop-widget-radio-svg">
                <circle cx="12" cy="12" r="10" stroke="var(--loop-widget-purchase-option-radio-accent-color)" stroke-width="2"/>
                <circle cx="12" cy="12" r="6" fill="var(--loop-widget-purchase-option-radio-accent-color)"/>
            </svg>`;
        }

        generateLoopWidgetRadioInput(productId, sellingPlanGroupId, spgLength) {
            const requires_selling_plan = window.LOOP_WIDGET[productId].product.requires_selling_plan;
            if (spgLength === 1 && requires_selling_plan) {
                return '';
            }
            const radioHtml = this.getLoopWidgetSvgRadio();

            return `
            <div id="loop-widget-purchase-option-radio-id-${sellingPlanGroupId}" class="loop-widget-purchase-option-radio">
                ${radioHtml}
            </div>
        `;
        }

        generateLoopWidgetTooltip(productId) {
            return getLoopWidgetPreferenceByKey(productId, "showSubscriptionDetailsPopup") ? `
            <div class="loop-widget-tooltip-container">
                <div class="loop-widget-tooltip-header">
                    <div class="loop-widget-tooltip-image">
                        <svg width="15" height="15" viewBox="0 0 90 90" xmlns="http://www.w3.org/2000/svg" class="loop-widget-tooltip-svg">
                            <path d="M45 0C20.1827 0 0 20.1827 0 45C0 69.8173 20.1827 90 45 90C69.8173 90 90 69.8174 90 45C90.0056 44.6025 89.9322 44.2078 89.7839 43.8389C89.6357 43.47 89.4156 43.1342 89.1365 42.8511C88.8573 42.568 88.5247 42.3432 88.158 42.1897C87.7912 42.0363 87.3976 41.9573 87 41.9573C86.6024 41.9573 86.2088 42.0363 85.842 42.1897C85.4753 42.3432 85.1427 42.568 84.8635 42.8511C84.5844 43.1342 84.3643 43.47 84.2161 43.8389C84.0678 44.2078 83.9944 44.6025 84 45C84 66.5748 66.5747 84 45 84C23.4253 84 6 66.5747 6 45C6 23.4254 23.4253 6 45 6C56.1538 6 66.3012 10.5882 73.4375 18H65.4062C65.0087 17.9944 64.614 18.0678 64.2451 18.2161C63.8762 18.3643 63.5405 18.5844 63.2573 18.8635C62.9742 19.1427 62.7494 19.4753 62.596 19.842C62.4425 20.2088 62.3635 20.6024 62.3635 21C62.3635 21.3976 62.4425 21.7912 62.596 22.158C62.7494 22.5247 62.9742 22.8573 63.2573 23.1365C63.5405 23.4156 63.8762 23.6357 64.2451 23.7839C64.614 23.9322 65.0087 24.0056 65.4062 24H79.8125C80.6081 23.9999 81.3711 23.6838 81.9337 23.1212C82.4963 22.5586 82.8124 21.7956 82.8125 21V6.59375C82.821 6.18925 82.7476 5.78722 82.5966 5.41183C82.4457 5.03644 82.2205 4.69545 81.9344 4.40936C81.6483 4.12327 81.3073 3.898 80.9319 3.7471C80.5565 3.5962 80.1545 3.52277 79.75 3.53125C79.356 3.53941 78.9675 3.62511 78.6067 3.78344C78.2458 3.94177 77.9197 4.16963 77.6469 4.45402C77.3741 4.73841 77.16 5.07375 77.0168 5.44089C76.8737 5.80803 76.8042 6.19977 76.8125 6.59375V12.875C68.6156 4.86282 57.3081 0 45 0ZM43.75 20.75C43.356 20.7582 42.9675 20.8439 42.6067 21.0022C42.2458 21.1605 41.9197 21.3884 41.6469 21.6728C41.3741 21.9572 41.16 22.2925 41.0168 22.6596C40.8737 23.0268 40.8042 23.4185 40.8125 23.8125V47.375C40.8116 47.7693 40.8883 48.16 41.0385 48.5246C41.1886 48.8892 41.4092 49.2207 41.6875 49.5L54.0938 61.9375C54.6573 62.5011 55.4217 62.8177 56.2188 62.8177C57.0158 62.8177 57.7802 62.5011 58.3438 61.9375C58.9073 61.3739 59.224 60.6095 59.224 59.8125C59.224 59.0155 58.9073 58.2511 58.3438 57.6875L46.8125 46.1875V23.8125C46.821 23.408 46.7476 23.006 46.5966 22.6306C46.4457 22.2552 46.2205 21.9142 45.9344 21.6281C45.6483 21.342 45.3073 21.1168 44.9319 20.9658C44.5565 20.8149 44.1545 20.7415 43.75 20.75Z"></path>
                        </svg>
                    </div>
                    <div class="loop-widget-tooltip-label">${getLoopWidgetTextsByKey(productId, "subscriptionDetailsText")}</div>
                </div>
                <div class="loop-widget-tooltip-text">
                    <div class="loop-widget-container-arrow"></div>
                    <div>${getLoopWidgetTextsByKey(productId, "subscriptionDetailsDescription")}</div>
                </div>
            </div>` : '';
        }

        setSvgDimensions(productId) {
            const svgList = document.getElementById(`loop-widget-container-id-${productId}`).querySelectorAll('.loop-widget-radio-svg');
            svgList.forEach(svg => {
                const width = getComputedStyle(document.documentElement).getPropertyValue('--loop-widget-purchase-option-radio-width');
                const height = getComputedStyle(document.documentElement).getPropertyValue('--loop-widget-purchase-option-radio-height');
                svg.setAttribute('width', width.trim());
                svg.setAttribute('height', height.trim());
            });
        }

        updateLoopWidgetDropdownArrowSVG() {
            const color = getComputedStyle(document.documentElement).getPropertyValue('--loop-widget-dropdown-arrow-svg-stroke-color').trim();
            const height = getComputedStyle(document.documentElement).getPropertyValue('--loop-widget-dropdown-arrow-svg-height').trim();
            const width = getComputedStyle(document.documentElement).getPropertyValue('--loop-widget-dropdown-arrow-svg-width').trim();

            const finalColor = color || '#000';
            const finalHeight = height || '30px';
            const finalWidth = width || '30px';

            const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${finalWidth}' height='${finalHeight}' viewBox='0 0 24 24' fill='none'><path d='M17 9.5L12 14.5L7 9.5' stroke='${finalColor}' stroke-linecap='round' stroke-linejoin='round'/></svg>`;
            const encodedSVG = encodeURIComponent(svg);

            const styleContent = `.loop-widget-sp-selector-container::after { background-image: url("data:image/svg+xml;utf8,${encodedSVG}"); background-size: contain; }`;
            let style = document.getElementById('loop-widget-dropdown-arrow-svg');
            if (!style) {
                style = document.createElement('style');
                style.id = 'loop-widget-dropdown-arrow-svg';
                document.body.appendChild(style);
            }
            style.textContent = styleContent;
        }

        updateSelectSVG() {
            const color = getComputedStyle(document.documentElement).getPropertyValue('--loop-widget-svg-stroke-color').trim();
            const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30' viewBox='0 0 24 24' fill='none'><path d='M17 9.5L12 14.5L7 9.5' stroke='${color}' stroke-linecap='round' stroke-linejoin='round'/></svg>`;
            const encodedSVG = encodeURIComponent(svg);

            const style = document.createElement('style');
            style.textContent = `.loop-widget-sp-selector-container::after { background-image: url("data:image/svg+xml;utf8,${encodedSVG}"); }`;

            const existingStyle = document.getElementById('loop-widget-svg-style');
            if (existingStyle) {
                existingStyle.remove();
            }

            style.id = 'loop-widget-svg-style';
            document.head.appendChild(style);
        }

        // ********************** Event Handling & User Interactions ******************
        attachEventListeners() {
            const productId = this.productId;
            const container = document.getElementById(`loop-widget-container-id-${productId}`);
            if (!container) return;

            this.attachSellingPlanChangeListener(productId);

            // Selling Plan Group container (click event)
            const spgContainers = container.querySelectorAll('[data-loop-widget-selling-plan-group]');
            spgContainers.forEach(spg => {
                spg.addEventListener('click', (event) => {
                    const groupId = spg.dataset.sellingPlanGroupId;
                    if (event.target.classList.contains('loop-widget-sp-button')) {
                        this.handleLoopWidgetSellingPlanChange(event, productId, groupId);
                    } else if ((typeof event.target?.className?.includes !== 'function' || !event.target.className.includes("loop-widget-sp-selector")) &&
                        (typeof event?.target?.parentNode?.className?.includes !== 'function' || !event.target.parentNode.className.includes("loop-widget-sp-selector"))) {
                        this.handleLoopWidgetSellingPlanGroupChange(productId, groupId, event);
                    }
                });
            });

            // Onetime purchase option (click event)
            const onetimeOption = container.querySelector('.loop-widget-purchase-option-onetime');
            if (onetimeOption) {
                onetimeOption.addEventListener('click', () => {
                    this.handleLoopWidgetOnetimeClick(productId);
                });
            }
        }

        attachSellingPlanChangeListener(productId) {
            // Selling Plan Selector (change event)
            const container = document.getElementById(`loop-widget-container-id-${productId}`);
            if (!container) return;
            const sellingPlanSelectors = container.querySelectorAll('.loop-widget-sp-selector');
            sellingPlanSelectors.forEach(select => {
                select.addEventListener('change', (event) => {
                    const groupId = select.dataset.sellingPlanGroupId;
                    this.handleLoopWidgetSellingPlanChange(event, productId, groupId);
                });
            });
        }

        handleLoopWidgetSellingPlanChange(event, productId, sellingPlanGroupId) {
            if (event.stopPropagation) {
                event.stopPropagation();
            }
            const selectedSpgId = window.LOOP_WIDGET[productId]['selectedSellingPlanGroupId'];
            if (selectedSpgId !== sellingPlanGroupId) {
                this.handleLoopWidgetSellingPlanGroupChange(productId, sellingPlanGroupId, event);
                return;
            }
            const sellingPlanId = event.target.value ?? Number(event.target.dataset.sellingPlanId);
            window.LOOP_WIDGET[productId]['selectedSellingPlanId'] = sellingPlanId;
            handleLoopWidgetSellingPlanValue(productId, sellingPlanId, true);
            this.changeLoopWidgetSellingPlanGroupPrice(sellingPlanId, productId, sellingPlanGroupId);
            this.changeLoopWidgetSellingPlanGroupDiscount(sellingPlanId, productId, sellingPlanGroupId);
            this.changeLoopWidgetSellingPlanGroupDescription(productId, sellingPlanGroupId, sellingPlanId);
            this.markSelectedFlagOnSellingPlan(productId, sellingPlanId, sellingPlanGroupId);
        }

        handleLoopWidgetSellingPlanGroupChange(productId, groupId, event) {
            window.LOOP_WIDGET[productId]['selectedSellingPlanGroupId'] = groupId;
            const variantSellingPlans = loopWidgetGetVariantSpgSellingPlans(productId, groupId);
            this.uncheckLoopWidgetSellingPlans(productId);
            this.removeLoopWidgetSpgSelected(productId);
            handleLoopWidgetSellingPlanValue(productId, this.getSelectedPlanIdForGroup(productId, groupId) ?? variantSellingPlans[0], true);
            const radio = document.getElementById(`loop-widget-purchase-option-radio-id-${groupId}`);
            if (radio) {
                radio.innerHTML = this.getLoopWidgetSvgRadio();
            }

            const container = document.getElementById(`loop-widget-container-id-${productId}`)?.querySelector(`#loop-widget-purchase-option-id-${groupId}`);
            if (container) {
                container.classList.add("loop-widget-purchase-option-selected");
            }

            if (!getLoopWidgetPreferenceByKey(productId, "alwaysShowSellingPlanDetails")) {
                document.querySelectorAll(`#loop-widget-container-id-${productId} .expanded`).forEach(ele => ele.classList.remove('expanded'));
                setTimeout(() => {
                    if (container) {
                        const spgContainer = container.querySelector('.loop-widget-spg-container');
                        if (spgContainer) {
                            spgContainer.classList.add('expanded');
                        }
                    }
                }, 50);
            }

            this.selectDefaultPlanForGroup(productId, groupId);
            loopWidgetUpdateAddToCartButtonText(productId);
            this.updateSelectSVG();
        }

        handleLoopWidgetOnetimeClick(productId) {
            if (!getLoopWidgetPreferenceByKey(productId, "alwaysShowSellingPlanDetails")) {
                document.querySelectorAll(`#loop-widget-container-id-${productId} .expanded`).forEach(ele => ele.classList.remove('expanded'));
            }
            this.uncheckLoopWidgetSellingPlans(productId);
            this.removeLoopWidgetSpgSelected(productId);
            this.removeSpSelectedButtons(productId);
            handleLoopWidgetSellingPlanValue(productId, null, false);
            loopWidgetUpdateAddToCartButtonText(productId);
            const radio = document.getElementById(`loop-widget-onetime-purchase-option-radio-id-${productId}`);
            if (radio) {
                radio.innerHTML = this.getLoopWidgetSvgRadio();
            }
            const onetimeOption = document.getElementById(`loop-widget-container-id-${productId}`)?.querySelector(`.loop-widget-purchase-option-onetime`);
            if (onetimeOption) {
                onetimeOption.classList.add("loop-widget-purchase-option-selected");
            }
            const onetimeOptionDescription = document.getElementById(`loop-widget-container-id-${productId}`)?.querySelector(`.loop-widget-purchase-option-description-container`);
            if (onetimeOptionDescription) {
                onetimeOptionDescription.classList.add("expanded");
            }
            window.LOOP_WIDGET[productId]['selectedSellingPlanGroupId'] = null;
        }

        // ********************* Selection & State Management ******************
        selectLoopWidgetPurchaseOption(productId) {
            const variantSellingPlanGroups = getVariantSellingPlanGroups(productId, getLoopWidgetVariantId(productId));
            const spgIdToSelect = getPreviousSpgSelectedForVariant(productId, variantSellingPlanGroups);
            const requires_selling_plan = window.LOOP_WIDGET[productId].product.requires_selling_plan;
            if (requires_selling_plan) {
                hideOneTimePurchaseOptionLoopWidget(productId);
            }

            if ((getLoopWidgetPreferenceByKey(productId, "purchaseOptionLabel") === "Subscription" && variantSellingPlanGroups.length) || spgIdToSelect || getLoopWidgetProductBundleData(productId).purchaseType === "SUBSCRIPTION" || requires_selling_plan) {
                this.handleLoopWidgetSellingPlanGroupChange(productId, spgIdToSelect ?? variantSellingPlanGroups[0]?.id);
                this.selectDefaultPlanForGroup(productId, spgIdToSelect ?? variantSellingPlanGroups[0]?.id);
            } else {
                this.handleLoopWidgetOnetimeClick(productId);
            }
        }

        selectDefaultPlanForGroup(productId, groupId) {
            try {
                const storeDefaultSellingPlanShopifyIds = getStoreDefaultSellingPlanShopifyIds(productId);
                if (!storeDefaultSellingPlanShopifyIds.length) return;
                const selectedVariantId = getLoopWidgetVariantId(productId);
                const selectedGroupSellingPlanShopifyIds = window.LOOP_WIDGET[productId]['variantToSellingPlans'][selectedVariantId][groupId];
                const defaultSellingPlanShopifyId = getCommonElements(storeDefaultSellingPlanShopifyIds, selectedGroupSellingPlanShopifyIds)?.[0];
                if (defaultSellingPlanShopifyId) {
                    this.handleLoopWidgetSellingPlanChange({ target: { value: defaultSellingPlanShopifyId } }, productId, groupId);
                }
                this.selectDefaultPlanForAllGroups(productId, selectedVariantId);
            } catch (error) {
                widgetLogger("Could not select default plan", error);
            }
        }

        selectDefaultPlanForAllGroups(productId, selectedVariantId) {
            const variantSellingPlanGroups = window.LOOP_WIDGET[productId]['variantToSellingPlans'][selectedVariantId];
            const storeDefaultSellingPlanShopifyIds = getStoreDefaultSellingPlanShopifyIds(productId);
            for (const groupId in variantSellingPlanGroups) {
                const groupSpIds = variantSellingPlanGroups[groupId];
                if (groupSpIds.length) {
                    const defaultSellingPlanShopifyId = getCommonElements(storeDefaultSellingPlanShopifyIds, groupSpIds)?.[0];
                    if (defaultSellingPlanShopifyId) {
                        changeDropdownValueBySelectId(`loop-widget-sp-selector-dropdown-${groupId}`, defaultSellingPlanShopifyId);
                    }
                }
            }
        }

        getSelectedPlanIdForGroup(productId, sellingPlanGroupId) {
            const widgetContainer = document.getElementById(`loop-widget-container-id-${productId}`);
            if (widgetContainer) {
                const spgEle = widgetContainer.querySelector(`#loop-widget-purchase-option-id-${sellingPlanGroupId}`);
                if (spgEle) {
                    const selectedOption = spgEle.querySelector(`option.loop-widget-sp-option[data-selected="true"]`);
                    if (selectedOption) {
                        return Number(selectedOption.value);
                    }
                }
            }
            return null;
        }

        markSelectedFlagOnSellingPlan(productId, sellingPlanId, sellingPlanGroupId) {
            const widgetContainer = document.getElementById(`loop-widget-container-id-${productId}`);
            if (widgetContainer) {
                if (getLoopWidgetPreferenceByKey(productId, "sellingPlanFrequencyOptions") === "BUTTON") {
                    const spEls = widgetContainer.querySelectorAll(`.loop-widget-sp-button`);
                    if (spEls.length > 0) {
                        spEls.forEach((spEle) => {
                            const planId = Number(spEle.dataset.sellingPlanId);
                            if (planId === Number(sellingPlanId)) {
                                spEle.classList.add('loop-widget-sp-button-selected');
                            } else {
                                spEle.classList.remove('loop-widget-sp-button-selected');
                            }
                        });
                    }
                    return;
                }
                const spgEle = widgetContainer.querySelector(`#loop-widget-purchase-option-id-${sellingPlanGroupId}`);
                if (spgEle) {
                    const spEls = spgEle.querySelectorAll(`option.loop-widget-sp-option`);
                    if (spEls.length > 0) {
                        spEls.forEach((spEle) => {
                            if (spEle && spEle.value && Number(spEle.value) === Number(sellingPlanId)) {
                                spEle.setAttribute('data-selected', 'true');
                            } else {
                                spEle.removeAttribute('data-selected');
                            }
                        });
                    }
                }
            }
        }

        // ********************* Dynamic Updates & DOM Manipulation ******************
        changeLoopWidgetSellingPlanGroupPrice(sellingPlanId, productId, sellingPlanGroupId) {
            const storeJson = window.LOOP_WIDGET[productId]['storeJson'];
            const variant = getLoopWidgetVariantById(productId, getLoopWidgetVariantId(productId));
            const sellingPlan = variant.selling_plan_allocations.find(a => a.selling_plan_id == sellingPlanId);
            const { deliveryFreq, isPrepaid } = getLoopWidgetPrepaidSellingPlanDeliveryFreq(productId, sellingPlan.selling_plan_id);
            const value = storeJson.presetBundleShopifyProductIds?.includes(productId) ? getLoopWidgetBundlePriceBySellingPlanId(productId, sellingPlanId, false) || sellingPlan.price / deliveryFreq : sellingPlan.price / deliveryFreq;
            document.getElementById(`loop-widget-purchase-option-price-id-${sellingPlanGroupId}`).innerHTML = loopWidgetFormatPrice(value);
            if (isPrepaid && getLoopWidgetPreferenceByKey(productId, "showFullPriceForPrepaidPlans")) {
                const text = getLoopWidgetTextsByKey(productId, "prepaidFullPriceText").replace("{{prepaid_price}}", loopWidgetFormatPrice(sellingPlan.price)).replace("{{deliveries_per_charge}}", deliveryFreq)
                document.getElementById(`loop-widget-purchase-option-total-prepaid-price-id-${sellingPlanGroupId}`).innerHTML = text;
            }
        }

        changeLoopWidgetSellingPlanGroupDiscount(sellingPlanId, productId, sellingPlanGroupId) {
            const variant = getLoopWidgetVariantById(productId, getLoopWidgetVariantId(productId));
            const sellingPlanGroup = window.LOOP_WIDGET[productId]['product'].selling_plan_groups.find(g => g.id === sellingPlanGroupId);
            const sellingPlan = sellingPlanGroup.selling_plans.find(p => p.id == sellingPlanId);
            const { discount, discountText } = getLoopWidgetDiscount(productId, sellingPlan, variant);
            const discEle = document.getElementById(`loop-widget-purchase-option-discount-badge-id-${sellingPlanGroupId}`);
            if (discEle) {
                discEle.innerHTML = `${getLoopWidgetTextsByKey(productId, "discountBadgeText").replace("{{discount_value}}", `${discountText}`)}`;
                if (discount > 0) {
                    discEle.classList.remove("loop-display-none")
                } else {
                    discEle.classList.add("loop-display-none")
                }
            }
        }

        changeLoopWidgetSellingPlanGroupDescription(productId, sellingPlanGroupId, sellingPlanId) {
            const sellingPlanGroup = window.LOOP_WIDGET[productId]['product'].selling_plan_groups.find(g => g.id === sellingPlanGroupId);
            const sellingPlan = sellingPlanGroup.selling_plans.find(p => p.id === Number(sellingPlanId));
            const description = sellingPlan?.description || "";
            const descriptionEle = document.getElementById(`loop-widget-sp-selector-description-id-${sellingPlanGroupId}`);
            if (descriptionEle) {
                descriptionEle.innerHTML = description;
            } else {
                // const container = document.getElementById(`loop-widget-container-id-${productId}`);
                // const spgContainer = container?.querySelector(`#loop-widget-spg-container-id-${sellingPlanGroupId}`);
                // if (spgContainer) {
                //     spgContainer.innerHTML = spgContainer.innerHTML + this.generateLoopWidgetSellingPlanDescription(sellingPlanGroupId, description);
                //     this.attachSellingPlanChangeListener(productId);
                // }
            }
        }

        uncheckLoopWidgetSellingPlans(productId) {
            document
                .getElementById(`loop-widget-container-id-${productId}`)
                .querySelectorAll('.loop-widget-purchase-option-radio')
                .forEach(spg => {
                    spg.innerHTML = this.getLoopWidgetSvgRadio()
                });
        }

        removeLoopWidgetSpgSelected(productId) {
            document.getElementById(`loop-widget-container-id-${productId}`).querySelectorAll(".loop-widget-purchase-option").forEach(ele => ele.classList.remove('loop-widget-purchase-option-selected'));
        }

        removeSpSelectedButtons(productId) {
            if (!getLoopWidgetPreferenceByKey(productId, "sellingPlanFrequencyOptions")) {
                return;
            }
            const widgetContainer = document.getElementById(`loop-widget-container-id-${productId}`);
            if (widgetContainer) {
                const spEls = widgetContainer.querySelectorAll(`.loop-widget-sp-button-selected`);
                if (spEls.length > 0) {
                    spEls.forEach((spEle) => {
                        spEle.classList.remove('loop-widget-sp-button-selected');
                    });
                }
            }
        }
    }

    // BUTTON_GROUP layout
    class ButtonGroupLayout {
        constructor(productId) {
            this.productId = productId;
        }

        // ***************** Main Widget Generation (Entry Points) *****************
        initButtonLayout(productId) {
            const variantId = getLoopWidgetVariantId(productId);
            this.generateLoopWidget(productId, variantId);
            this.selectPurchaseOption(productId);
            this.updateDropdownArrowSVG(productId);
            this.attachEventListeners();
        }

        generateLoopWidget(productId, variantId) {
            const loopWidgetContainer = document.getElementById(`loop-widget-container-id-${productId}`);
            if (!loopWidgetContainer) return;

            const requires_selling_plan = window.LOOP_WIDGET[productId].product.requires_selling_plan;
            let availableSellingPlanGroups = getVariantSellingPlanGroups(productId, variantId);
            if (requires_selling_plan && getLoopWidgetPreferenceByKey(productId, "hideWidgetIfOnePlanAvailable") && availableSellingPlanGroups.length === 1) {
                hideLoopWidget(productId, "generateLoopWidget", "hideWidgetIfOnePlanAvailable and selling plan groups length is 1");
            }

            loopWidgetContainer.innerHTML = `
                ${this.generatePurchaseOptionsLabel(productId)}
                ${this.generatePurchaseOptions(productId, variantId)}
                ${this.generatePurchaseOptionsDescription(productId)}
                ${this.generateTooltip(productId)}
            `;
        }

        generatePurchaseOptions(productId, variantId) {
            return `
                <div class="loop-w-btn-group-purchase-options-container">
                    ${getLoopWidgetPreferenceByKey(productId, "purchaseOptionsOrder") === "Display one-time purchase first" ? this.generateOnetimeContainer(productId, variantId) : ''}
                    ${this.generateSellingPlanContainer(productId, variantId)}
                    ${getLoopWidgetPreferenceByKey(productId, "purchaseOptionsOrder") !== "Display one-time purchase first" ? this.generateOnetimeContainer(productId, variantId) : ''}
                </div>
            `;
        }

        // ***************** Container Generation (High-level HTML) ******************
        generatePurchaseOptionsLabel(productId) {
            return getLoopWidgetPreferenceByKey(productId, "showPurchaseOptionsLabel") ? `<div class="loop-w-btn-group-purchase-options-label">${getLoopWidgetTextsByKey(productId, "purchaseOptionLabel")}</div>` : '';
        }

        generateSellingPlanContainer(productId, variantId) {
            let availableSellingPlanGroups = getVariantSellingPlanGroups(productId, variantId);
            if (availableSellingPlanGroups.length === 0) {
                hideLoopWidget(productId, "generateSellingPlanContainer", "availableSellingPlanGroups length is 0");
            }

            return this.getSellingPlanContainerTemplate(productId, availableSellingPlanGroups);
        }

        generateOnetimeContainer(productId, variantId) {
            const onetimeContainerClass = [
                "loop-w-btn-group-purchase-option",
                "loop-w-btn-group-purchase-option-onetime"
            ].filter(Boolean).join(" ");
            const variant = getLoopWidgetVariantById(productId, variantId);
            return this.generateOnetimeContainerTemplate(productId, variant, onetimeContainerClass);
        }

        getOnetimeDescription(productId) {
            return `
                    ${getLoopWidgetTextsByKey(productId, "oneTimeDescriptionText") ?
                    `<div class="loop-w-btn-group-purchase-option-description-text">${getLoopWidgetTextsByKey(productId, "oneTimeDescriptionText")}</div>`
                    : ''}
                `
        }

        getSubscriptionDescription(productId) {
            const variantId = getLoopWidgetVariantId(productId);
            let availableSellingPlanGroups = getVariantSellingPlanGroups(productId, variantId);
            const selectedSpgId = window.LOOP_WIDGET[productId]['selectedSellingPlanGroupId'];

            const sellingPlanGroup = availableSellingPlanGroups.find(spg => spg.id === selectedSpgId);
            if (!sellingPlanGroup) {
                return '';
            }

            return `<div class="loop-w-btn-group-frequency-selector-container">
                ${sellingPlanGroup.selling_plans.length > 0 ? this.generateSellingPlanSelectorAndDesc(productId, sellingPlanGroup, sellingPlanGroup.id, sellingPlanGroup.selling_plans) : ''}
            </div>`
        }

        generatePurchaseOptionsDescription(productId) {
            return `<div id="loop-w-btn-group-description-id-${productId}" class="loop-w-btn-group-description-container loop-display-none"></div>`;
        }

        getSellingPlanContainerTemplate(productId, availableSellingPlanGroups) {
            return availableSellingPlanGroups.map(sellingPlanGroup => `
            <div data-loop-widget-selling-plan-group data-selling-plan-group-id=${sellingPlanGroup.id} id="loop-widget-purchase-option-id-${sellingPlanGroup.id}" class="loop-w-btn-group-purchase-option">
                <div class="loop-w-btn-group-purchase-option-header">
                    ${this.generateSpgLabel(sellingPlanGroup.id, sellingPlanGroup.name)}
                    ${this.generatePurchaseOptionDiscountBadge(productId, sellingPlanGroup.id)}
                </div>
                ${this.generatePurchaseOptionPriceContainer(productId, sellingPlanGroup.id)}
            </div>`).join(" ");
        }

        generateOnetimeContainerTemplate(productId, variant, onetimeContainerClass) {
            return `
            <div id="loop-w-btn-group-purchase-option-onetime-${productId}" class="${onetimeContainerClass}">
                <div class="loop-w-btn-group-purchase-option-header">
                    <div class="loop-w-btn-group-purchase-option-label">${getLoopWidgetTextsByKey(productId, "oneTimePurchaseLabel")}</div>
                </div>
                ${this.generateOnetimePriceTemplate(productId, variant)}
            </div>`
        }

        // ***************** Selling Plan HTML Generation ******************
        generateSellingPlanSelectorAndDesc(productId, sellingPlanGroup, sellingPlanGroupId, selling_plans) {
            const variantSellingPlans = loopWidgetGetVariantSpgSellingPlans(productId, sellingPlanGroupId);
            const filteredSPforVariant = selling_plans.filter(sp => variantSellingPlans.includes(sp.id));

            return this.generateLoopWidgetSpSelectorTemplate(productId, sellingPlanGroup, sellingPlanGroupId, filteredSPforVariant);
        }

        generatePlanSelectors(productId, sellingPlanGroup, sellingPlanGroupId, selling_plans) {
            const label = sellingPlanGroup?.options?.[0]?.name ?? "";

            if (getLoopWidgetPreferenceByKey(productId, "showPlanSelectorAsTextIfOnePlanAvailable") && selling_plans.length === 1) {
                return this.generateSpSelectorAsText(selling_plans, label, getLoopWidgetPreferenceByKey(productId, "sellingPlanFrequencyOptions") === "BUTTON");
            }

            if (selling_plans.length === 1) {
                return '';
            }

            if (getLoopWidgetPreferenceByKey(productId, "sellingPlanFrequencyOptions") === "BUTTON") {
                return this.generatePlanSelectorAsButton(productId, sellingPlanGroupId, selling_plans, label);
            }

            return this.generateSpSelectorAsDropdown(productId, sellingPlanGroupId, selling_plans, label);
        }

        generateLoopWidgetSpSelectorTemplate(productId, sellingPlanGroup, sellingPlanGroupId, filteredSPforVariant) {
            const description = filteredSPforVariant[0]?.description || "";

            return `
            <div id="loop-widget-spg-container-id-${sellingPlanGroupId}" class="loop-w-btn-group-description-subscription">
                ${this.generatePlanSelectors(productId, sellingPlanGroup, sellingPlanGroupId, filteredSPforVariant)}
                ${description ? this.generateSellingPlanDescription(sellingPlanGroupId, description) : ''}
            </div>`
        }

        generatePlanSelectorAsButton(productId, sellingPlanGroupId, selling_plans, label) {
            return `<div class="loop-w-btn-group-sp-button-selector-wrapper">
            <div class="loop-w-btn-group-sp-button-selector-label">${label}</div>
            <div id="loop-widget-sp-button-group-id-${sellingPlanGroupId}" class="loop-widget-sp-button-container">
                ${selling_plans.map(sp => this.generateSellingPlanButton(sp, productId, sellingPlanGroupId)).join('')}
            </div>
        </div>`
        }

        generateSpSelectorAsDropdown(productId, sellingPlanGroupId, selling_plans, label) {
            return `
          <div class="loop-widget-sp-selector-wrapper">
            <div class="loop-widget-sp-selector-label">${label}</div>
            <div class="loop-widget-sp-selector-container">
              <select id="loop-widget-sp-selector-dropdown-${sellingPlanGroupId}" data-selling-plan-group-id=${sellingPlanGroupId} class="loop-widget-sp-selector" name="selling_plan">
                ${selling_plans.map(this.generateSellingPlan).join('')}
              </select>
            </div>
          </div>`;
        }

        generateSpSelectorAsText(selling_plans, label, isBtnLabel) {
            const classNames = `loop-widget-sp-selector-label-as-text loop-widget-left-padding-0${isBtnLabel ? " loop-widget-sp-selector-btn-label-as-text" : ""}`;
            return `<div class="loop-widget-sp-selector-wrapper">
                <div class="${classNames}"><span class="loop-widget-sp-selector-as-text-label">${label}: </span><span class="loop-widget-sp-option">${selling_plans[0].name}</span></div>
            </div>`
        }

        generateSellingPlan(sp) {
            return `<option class="loop-widget-sp-option" value="${sp.id}">${sp.options[0].value ?? sp.name}</option>`;
        }

        generateSellingPlanButton(sp, productId, sellingPlanGroupId) {
            return `<div id="loop-widget-sp-button-id-${sp.id}" data-selling-plan-group-id=${sellingPlanGroupId} data-selling-plan-id=${sp.id} class="loop-widget-sp-button">
               ${sp.options[0].value ?? sp.name}
        </div>`;
        }

        generateSellingPlanDescription(sellingPlanGroupId, description) {
            return `
            <div class="loop-widget-sp-selector-description-wrapper">
                <div id="loop-widget-sp-selector-description-id-${sellingPlanGroupId}" class="loop-w-btn-group-purchase-option-description-text">${description}</div>
            </div>`;
        }

        // ******************** Price & Discount HTML Generation ******************
        generatePurchaseOptionPriceContainer(productId, sellingPlanGroupId) {
            const storeJson = window.LOOP_WIDGET[productId]['storeJson'];
            const variant = getLoopWidgetVariantById(productId, getLoopWidgetVariantId(productId));
            const sellingPlans = loopWidgetGetVariantSpgSellingPlans(productId, sellingPlanGroupId);
            const sellingPlan = variant.selling_plan_allocations.find(a => a.selling_plan_id === sellingPlans[0]);
            const { deliveryFreq, isPrepaid } = getLoopWidgetPrepaidSellingPlanDeliveryFreq(productId, sellingPlan.selling_plan_id);
            const originalPrice = LOOP_WIDGET_USE_COMPARE_AT_PRICE ? variant.compare_at_price : variant.price;
            const price = storeJson.presetBundleShopifyProductIds.includes(productId) ? getLoopWidgetBundlePriceBySellingPlanId(productId, sellingPlan.selling_plan_id, false) || sellingPlan.price / deliveryFreq : sellingPlan.price / deliveryFreq;
            const totalPrepaidPrice = sellingPlan.price;
            return this.getPurchaseOptionPriceTemplate(productId, sellingPlanGroupId, originalPrice, price, totalPrepaidPrice, deliveryFreq, isPrepaid);
        }

        getPurchaseOptionPriceTemplate(productId, sellingPlanGroupId, originalPrice, price, totalPrepaidPrice, deliveryFreq, isPrepaid) {
            return `
            <div class="loop-w-btn-group-purchase-option-price-each-container">
                <div class="loop-w-btn-group-purchase-option-price-container">
                    ${originalPrice === price || !getLoopWidgetPreferenceByKey(productId, "showCompareAtPrice") ? '' : `<div class="loop-w-btn-group-purchase-option-compare-at-price">${loopWidgetFormatPrice(originalPrice)}</div>`}
                    <div id="loop-widget-purchase-option-price-id-${sellingPlanGroupId}" class="loop-w-btn-group-purchase-option-price">${loopWidgetFormatPrice(price)}</div>
                </div>
                ${this.getPrepaidPriceOrEachText(productId, isPrepaid, deliveryFreq, totalPrepaidPrice, sellingPlanGroupId)}
            </div>`
        }

        generateOnetimePriceTemplate(productId, variant) {
            const storeJson = window.LOOP_WIDGET[productId]['storeJson'];
            const originalPrice = storeJson.presetBundleShopifyProductIds.includes(productId) ? variant.price : variant.compare_at_price;
            const price = storeJson.presetBundleShopifyProductIds.includes(productId) ? getLoopWidgetBundlePriceBySellingPlanId(productId, null, true) || (variant.price || variant.compare_at_price) : (variant.price || variant.compare_at_price);
            return this.getOnetimePriceTemplate(productId, originalPrice, price);
        }

        getOnetimePriceTemplate(productId, originalPrice, price) {
            return `
            <div class="loop-w-btn-group-purchase-option-price-each-container">
                <div class="loop-w-btn-group-purchase-option-price-container">
                    ${getLoopWidgetPreferenceByKey(productId, "showCompareAtPrice") ? `<div class="loop-w-btn-group-purchase-option-compare-at-price loop-display-none">${loopWidgetFormatPrice(originalPrice)}</div>` : ''}
                    <div id="loop-widget-purchase-option-price-onetime-${productId}" class="loop-w-btn-group-purchase-option-price">${loopWidgetFormatPrice(price)}</div>
                </div>
                ${!getLoopWidgetPreferenceByKey(productId, "hideEachLabel") ? `<div class="loop-w-btn-group-purchase-option-each-label">${getLoopWidgetTextsByKey(productId, "priceLabelText")}</div>` : ''}
            </div>`
        }

        generatePurchaseOptionDiscountBadge(productId, sellingPlanGroupId) {
            const variant = getLoopWidgetVariantById(productId, getLoopWidgetVariantId(productId));
            const variantSellingPlans = loopWidgetGetVariantSpgSellingPlans(productId, sellingPlanGroupId);
            const firstSellingPlan = window.LOOP_WIDGET[productId]['product'].selling_plan_groups.find(g => g.id === sellingPlanGroupId)['selling_plans'].find(sp => sp.id === variantSellingPlans[0]);
            const { discount, discountText } = getLoopWidgetDiscount(productId, firstSellingPlan, variant);
            const discText = getLoopWidgetTextsByKey(productId, "discountBadgeText")?.replace("{{discount_value}}", `${discountText}`);
            return getLoopWidgetPreferenceByKey(productId, "showDiscountBadgeForSubscription") ? `<div id="loop-widget-purchase-option-discount-badge-id-${sellingPlanGroupId}" class="loop-w-btn-group-purchase-option-discount-badge${discount > 0 ? '' : ' loop-display-none'}">${discText}</div>` : '';
        }

        getPrepaidPriceOrEachText(productId, isPrepaid, deliveryFreq, totalPrepaidPrice, sellingPlanGroupId) {
            if (isPrepaid && getLoopWidgetPreferenceByKey(productId, "showFullPriceForPrepaidPlans")) {
                return `<div id="loop-widget-purchase-option-total-prepaid-price-id-${sellingPlanGroupId}" class="loop-widget-purchase-option-total-prepaid-price">${getLoopWidgetTextsByKey(productId, "prepaidFullPriceText").replace("{{prepaid_price}}", loopWidgetFormatPrice(totalPrepaidPrice)).replace("{{deliveries_per_charge}}", deliveryFreq)}</div>`
            }

            return `${!getLoopWidgetPreferenceByKey(productId, "hideEachLabel") ? `<div class="loop-w-btn-group-purchase-option-each-label">${getLoopWidgetTextsByKey(productId, "priceLabelText")}</div>` : ''}`
        }

        // ********************* UI Components & SVG Generation ******************
        generateSpgLabel(id, name) {
            return `<div for="loop-widget-purchase-option-radio-id-${id}" class="loop-w-btn-group-purchase-option-label">${name}</div>`;
        }

        generateTooltip(productId) {
            return getLoopWidgetPreferenceByKey(productId, "showSubscriptionDetailsPopup") ? `
            <div class="loop-w-btn-group-tooltip-container">
                <div class="loop-widget-tooltip-header">
                    <div class="loop-widget-tooltip-image">
                        <svg width="15" height="15" viewBox="0 0 90 90" xmlns="http://www.w3.org/2000/svg" class="loop-widget-tooltip-svg">
                            <path d="M45 0C20.1827 0 0 20.1827 0 45C0 69.8173 20.1827 90 45 90C69.8173 90 90 69.8174 90 45C90.0056 44.6025 89.9322 44.2078 89.7839 43.8389C89.6357 43.47 89.4156 43.1342 89.1365 42.8511C88.8573 42.568 88.5247 42.3432 88.158 42.1897C87.7912 42.0363 87.3976 41.9573 87 41.9573C86.6024 41.9573 86.2088 42.0363 85.842 42.1897C85.4753 42.3432 85.1427 42.568 84.8635 42.8511C84.5844 43.1342 84.3643 43.47 84.2161 43.8389C84.0678 44.2078 83.9944 44.6025 84 45C84 66.5748 66.5747 84 45 84C23.4253 84 6 66.5747 6 45C6 23.4254 23.4253 6 45 6C56.1538 6 66.3012 10.5882 73.4375 18H65.4062C65.0087 17.9944 64.614 18.0678 64.2451 18.2161C63.8762 18.3643 63.5405 18.5844 63.2573 18.8635C62.9742 19.1427 62.7494 19.4753 62.596 19.842C62.4425 20.2088 62.3635 20.6024 62.3635 21C62.3635 21.3976 62.4425 21.7912 62.596 22.158C62.7494 22.5247 62.9742 22.8573 63.2573 23.1365C63.5405 23.4156 63.8762 23.6357 64.2451 23.7839C64.614 23.9322 65.0087 24.0056 65.4062 24H79.8125C80.6081 23.9999 81.3711 23.6838 81.9337 23.1212C82.4963 22.5586 82.8124 21.7956 82.8125 21V6.59375C82.821 6.18925 82.7476 5.78722 82.5966 5.41183C82.4457 5.03644 82.2205 4.69545 81.9344 4.40936C81.6483 4.12327 81.3073 3.898 80.9319 3.7471C80.5565 3.5962 80.1545 3.52277 79.75 3.53125C79.356 3.53941 78.9675 3.62511 78.6067 3.78344C78.2458 3.94177 77.9197 4.16963 77.6469 4.45402C77.3741 4.73841 77.16 5.07375 77.0168 5.44089C76.8737 5.80803 76.8042 6.19977 76.8125 6.59375V12.875C68.6156 4.86282 57.3081 0 45 0ZM43.75 20.75C43.356 20.7582 42.9675 20.8439 42.6067 21.0022C42.2458 21.1605 41.9197 21.3884 41.6469 21.6728C41.3741 21.9572 41.16 22.2925 41.0168 22.6596C40.8737 23.0268 40.8042 23.4185 40.8125 23.8125V47.375C40.8116 47.7693 40.8883 48.16 41.0385 48.5246C41.1886 48.8892 41.4092 49.2207 41.6875 49.5L54.0938 61.9375C54.6573 62.5011 55.4217 62.8177 56.2188 62.8177C57.0158 62.8177 57.7802 62.5011 58.3438 61.9375C58.9073 61.3739 59.224 60.6095 59.224 59.8125C59.224 59.0155 58.9073 58.2511 58.3438 57.6875L46.8125 46.1875V23.8125C46.821 23.408 46.7476 23.006 46.5966 22.6306C46.4457 22.2552 46.2205 21.9142 45.9344 21.6281C45.6483 21.342 45.3073 21.1168 44.9319 20.9658C44.5565 20.8149 44.1545 20.7415 43.75 20.75Z"></path>
                        </svg>
                    </div>
                    <div class="loop-widget-tooltip-label">${getLoopWidgetTextsByKey(productId, "subscriptionDetailsText")}</div>
                </div>
                <div class="loop-widget-tooltip-text">
                    <div class="loop-widget-container-arrow"></div>
                    <div>${getLoopWidgetTextsByKey(productId, "subscriptionDetailsDescription")}</div>
                </div>
            </div>` : '';
        }

        updateDropdownArrowSVG() {
            const color = getComputedStyle(document.documentElement).getPropertyValue('--loop-widget-dropdown-arrow-svg-stroke-color').trim();
            const height = getComputedStyle(document.documentElement).getPropertyValue('--loop-widget-dropdown-arrow-svg-height').trim();
            const width = getComputedStyle(document.documentElement).getPropertyValue('--loop-widget-dropdown-arrow-svg-width').trim();

            const finalColor = color || '#000';
            const finalHeight = height || '30px';
            const finalWidth = width || '30px';

            const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${finalWidth}' height='${finalHeight}' viewBox='0 0 24 24' fill='none'><path d='M17 9.5L12 14.5L7 9.5' stroke='${finalColor}' stroke-linecap='round' stroke-linejoin='round'/></svg>`;
            const encodedSVG = encodeURIComponent(svg);

            const styleContent = `.loop-widget-sp-selector-container::after { background-image: url("data:image/svg+xml;utf8,${encodedSVG}"); background-size: contain; }`;
            let style = document.getElementById('loop-widget-dropdown-arrow-svg');
            if (!style) {
                style = document.createElement('style');
                style.id = 'loop-widget-dropdown-arrow-svg';
                document.body.appendChild(style);
            }
            style.textContent = styleContent;
        }

        updateSelectSVG() {
            const color = getComputedStyle(document.documentElement).getPropertyValue('--loop-widget-svg-stroke-color').trim();
            const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30' viewBox='0 0 24 24' fill='none'><path d='M17 9.5L12 14.5L7 9.5' stroke='${color}' stroke-linecap='round' stroke-linejoin='round'/></svg>`;
            const encodedSVG = encodeURIComponent(svg);

            const style = document.createElement('style');
            style.textContent = `.loop-widget-sp-selector-container::after { background-image: url("data:image/svg+xml;utf8,${encodedSVG}"); }`;

            const existingStyle = document.getElementById('loop-widget-svg-style');
            if (existingStyle) {
                existingStyle.remove();
            }

            style.id = 'loop-widget-svg-style';
            document.head.appendChild(style);
        }

        // ********************** Event Handling & User Interactions ******************
        attachEventListeners() {
            const productId = this.productId;
            const container = document.getElementById(`loop-widget-container-id-${productId}`);
            if (!container) return;

            // Selling Plan Group container (click event)
            const spgContainers = container.querySelectorAll('[data-loop-widget-selling-plan-group]');
            spgContainers.forEach(spg => {
                spg.addEventListener('click', (event) => {
                    const groupId = spg.dataset.sellingPlanGroupId;
                    this.handleLoopWidgetSellingPlanGroupChange(productId, groupId, event);
                });
            });

            // Onetime purchase option (click event)
            const onetimeOption = container.querySelector('.loop-w-btn-group-purchase-option-onetime');
            if (onetimeOption) {
                onetimeOption.addEventListener('click', () => {
                    this.handleLoopWidgetOnetimeClick(productId);
                });
            }
        }

        attachSellingPlanListener(productId) {
            const container = document.getElementById(`loop-widget-container-id-${productId}`);
            if (!container) return;

            const sellingPlanSelectors = container.querySelectorAll('.loop-widget-sp-selector');
            sellingPlanSelectors.forEach(select => {
                select.addEventListener('change', (event) => {
                    const groupId = select.dataset.sellingPlanGroupId;
                    this.handleLoopWidgetSellingPlanChange(event, productId, groupId);
                });
            });

            // Selling Plan Buttons (click event)
            const sellingPlanButtons = container.querySelectorAll('.loop-widget-sp-button');
            sellingPlanButtons.forEach(button => {
                button.addEventListener('click', (event) => {
                    const groupId = button.dataset.sellingPlanGroupId;
                    this.handleLoopWidgetSellingPlanChange(event, productId, groupId);
                });
            });
        }

        handleLoopWidgetSellingPlanChange(event, productId, sellingPlanGroupId) {
            if (event.stopPropagation) {
                event.stopPropagation();
            }

            const sellingPlanId = event.target.value ?? Number(event.target.dataset.sellingPlanId);
            window.LOOP_WIDGET[productId]['selectedSellingPlanId'] = sellingPlanId;
            handleLoopWidgetSellingPlanValue(productId, sellingPlanId, true);
            this.changeSellingPlanGroupPrice(sellingPlanId, productId, sellingPlanGroupId);
            this.changeSellingPlanGroupDiscount(sellingPlanId, productId, sellingPlanGroupId);
            this.changeSellingPlanGroupDescription(productId, sellingPlanGroupId, sellingPlanId);
            this.markSelectedFlagOnSellingPlan(productId, sellingPlanId, sellingPlanGroupId);
            this.handleDescriptionContainer(productId);
        }

        handleDescriptionContainer(productId) {
            const variantId = getLoopWidgetVariantId(productId);
            let availableSellingPlanGroups = getVariantSellingPlanGroups(productId, variantId);
            const selectedSpgId = window.LOOP_WIDGET[productId]['selectedSellingPlanGroupId'];
            const selectedSpId = window.LOOP_WIDGET[productId]['selectedSellingPlanId'];

            const sellingPlanGroup = availableSellingPlanGroups.find(spg => spg.id === selectedSpgId);
            const selling_plans = sellingPlanGroup.selling_plans;

            const variantSellingPlans = loopWidgetGetVariantSpgSellingPlans(productId, selectedSpgId);
            const filteredSPforVariant = selling_plans.filter(sp => variantSellingPlans.includes(sp.id));
            const description = filteredSPforVariant?.find(sp => sp.id === selectedSpId)?.description || "";
            const show = description && description.length > 0 || filteredSPforVariant.length > 1 || getLoopWidgetPreferenceByKey(productId, "showPlanSelectorAsTextIfOnePlanAvailable");

            const descContainer = document.getElementById(`loop-widget-container-id-${productId}`)?.querySelector('.loop-w-btn-group-description-container');
            if (descContainer) {
                if (show) {
                    descContainer.classList.remove("loop-display-none");
                } else {
                    descContainer.classList.add("loop-display-none");
                }
            }

            const ele = document.getElementById(`loop-widget-container-id-${productId}`)?.querySelector('.loop-w-btn-group-description-container');
            if (!description) {
                if (ele) {
                    ele.style.gap = '0px';
                }
            } else {
                if (ele) {
                    ele.style.gap = '7px';
                }
            }
        }

        handleLoopWidgetSellingPlanGroupChange(productId, groupId, event) {
            window.LOOP_WIDGET[productId]['selectedSellingPlanGroupId'] = groupId;
            const variantSellingPlans = loopWidgetGetVariantSpgSellingPlans(productId, groupId);
            this.removeSpgSelected(productId);
            handleLoopWidgetSellingPlanValue(productId, this.getSelectedPlanIdForGroup(productId, groupId) ?? variantSellingPlans[0], true);

            // make spg selected
            const container = document.getElementById(`loop-widget-container-id-${productId}`)?.querySelector(`#loop-widget-purchase-option-id-${groupId}`);
            if (container) {
                container.classList.add("loop-w-btn-group-purchase-option-selected");
            }

            // add spg description
            const spgContainer = document.getElementById(`loop-widget-container-id-${productId}`)?.querySelector('.loop-w-btn-group-description-container');
            if (spgContainer) {
                spgContainer.innerHTML = this.getSubscriptionDescription(productId);
                this.selectDefaultPlanForGroup(productId, groupId);
                this.updateSelectSVG();
                this.attachSellingPlanListener(productId);
                this.handleDescriptionContainer(productId);
            }

            loopWidgetUpdateAddToCartButtonText(productId);
        }

        handleLoopWidgetOnetimeClick(productId) {
            window.LOOP_WIDGET[productId]['selectedSellingPlanGroupId'] = null;
            this.removeSpgSelected(productId);
            this.removeSpSelectedButtons(productId);
            handleLoopWidgetSellingPlanValue(productId, null, false);
            loopWidgetUpdateAddToCartButtonText(productId);

            // make onetime option selected
            const onetimeOption = document.getElementById(`loop-widget-container-id-${productId}`)?.querySelector(`.loop-w-btn-group-purchase-option-onetime`);
            if (onetimeOption) {
                onetimeOption.classList.add("loop-w-btn-group-purchase-option-selected");
            }

            // add onetime description
            const onetimeOptionDescription = document.getElementById(`loop-widget-container-id-${productId}`)?.querySelector(`.loop-w-btn-group-description-container`);
            if (onetimeOptionDescription && getLoopWidgetTextsByKey(productId, "oneTimeDescriptionText")) {
                onetimeOptionDescription.innerHTML = this.getOnetimeDescription(productId);
                onetimeOptionDescription.classList.remove("loop-display-none");
            } else {
                const spgContainer = document.getElementById(`loop-widget-container-id-${productId}`)?.querySelector('.loop-w-btn-group-description-container');
                if (spgContainer) {
                    spgContainer.classList.add("loop-display-none");
                }
            }
        }

        // ********************* Selection & State Management ******************
        selectPurchaseOption(productId) {
            const variantSellingPlanGroups = getVariantSellingPlanGroups(productId, getLoopWidgetVariantId(productId));
            const spgIdToSelect = getPreviousSpgSelectedForVariant(productId, variantSellingPlanGroups);
            const requires_selling_plan = window.LOOP_WIDGET[productId].product.requires_selling_plan;
            if (requires_selling_plan) {
                hideOneTimePurchaseOptionLoopWidget(productId);
            }

            if ((getLoopWidgetPreferenceByKey(productId, "purchaseOptionLabel") === "Subscription" && variantSellingPlanGroups.length) || spgIdToSelect || getLoopWidgetProductBundleData(productId).purchaseType === "SUBSCRIPTION" || requires_selling_plan) {
                this.handleLoopWidgetSellingPlanGroupChange(productId, spgIdToSelect ?? variantSellingPlanGroups[0]?.id);
                this.selectDefaultPlanForGroup(productId, spgIdToSelect ?? variantSellingPlanGroups[0]?.id);
            } else {
                this.handleLoopWidgetOnetimeClick(productId);
            }
        }

        selectDefaultPlanForGroup(productId, groupId) {
            try {
                const storeDefaultSellingPlanShopifyIds = getStoreDefaultSellingPlanShopifyIds(productId);
                if (!storeDefaultSellingPlanShopifyIds.length) return;
                const selectedVariantId = getLoopWidgetVariantId(productId);
                const selectedGroupSellingPlanShopifyIds = window.LOOP_WIDGET[productId]['variantToSellingPlans'][selectedVariantId][groupId];
                const defaultSellingPlanShopifyId = getCommonElements(storeDefaultSellingPlanShopifyIds, selectedGroupSellingPlanShopifyIds)?.[0];
                if (defaultSellingPlanShopifyId) {
                    this.handleLoopWidgetSellingPlanChange({ target: { value: defaultSellingPlanShopifyId } }, productId, groupId);
                }
                this.selectDefaultPlanForAllGroups(productId, selectedVariantId);
            } catch (error) {
                widgetLogger("Could not select default plan", error);
            }
        }

        selectDefaultPlanForAllGroups(productId, selectedVariantId) {
            const variantSellingPlanGroups = window.LOOP_WIDGET[productId]['variantToSellingPlans'][selectedVariantId];
            const storeDefaultSellingPlanShopifyIds = getStoreDefaultSellingPlanShopifyIds(productId);
            for (const groupId in variantSellingPlanGroups) {
                const groupSpIds = variantSellingPlanGroups[groupId];
                if (groupSpIds.length) {
                    const defaultSellingPlanShopifyId = getCommonElements(storeDefaultSellingPlanShopifyIds, groupSpIds)?.[0];
                    if (defaultSellingPlanShopifyId) {
                        changeDropdownValueBySelectId(`loop-widget-sp-selector-dropdown-${groupId}`, defaultSellingPlanShopifyId);
                    }
                }
            }
        }

        getSelectedPlanIdForGroup(productId, sellingPlanGroupId) {
            const widgetContainer = document.getElementById(`loop-widget-container-id-${productId}`);
            if (widgetContainer) {
                const spgEle = widgetContainer.querySelector(`#loop-widget-purchase-option-id-${sellingPlanGroupId}`);
                if (spgEle) {
                    const selectedOption = spgEle.querySelector(`option.loop-widget-sp-option[data-selected="true"]`);
                    if (selectedOption) {
                        return Number(selectedOption.value);
                    }
                }
            }
            return null;
        }

        markSelectedFlagOnSellingPlan(productId, sellingPlanId, sellingPlanGroupId) {
            const widgetContainer = document.getElementById(`loop-widget-container-id-${productId}`);
            if (widgetContainer) {
                if (getLoopWidgetPreferenceByKey(productId, "sellingPlanFrequencyOptions") === "BUTTON") {
                    const spEls = widgetContainer.querySelectorAll(`.loop-widget-sp-button`);
                    if (spEls.length > 0) {
                        spEls.forEach((spEle) => {
                            const planId = Number(spEle.dataset.sellingPlanId);
                            if (planId === Number(sellingPlanId)) {
                                spEle.classList.add('loop-widget-sp-button-selected');
                            } else {
                                spEle.classList.remove('loop-widget-sp-button-selected');
                            }
                        });
                    }
                    return;
                }
                const spgEle = widgetContainer.querySelector(`#loop-widget-purchase-option-id-${sellingPlanGroupId}`);
                if (spgEle) {
                    const spEls = spgEle.querySelectorAll(`option.loop-widget-sp-option`);
                    if (spEls.length > 0) {
                        spEls.forEach((spEle) => {
                            if (spEle && spEle.value && Number(spEle.value) === Number(sellingPlanId)) {
                                spEle.setAttribute('data-selected', 'true');
                            } else {
                                spEle.removeAttribute('data-selected');
                            }
                        });
                    }
                }
            }
        }

        // ********************* Dynamic Updates & DOM Manipulation ******************
        changeSellingPlanGroupPrice(sellingPlanId, productId, sellingPlanGroupId) {
            const storeJson = window.LOOP_WIDGET[productId]['storeJson'];
            const variant = getLoopWidgetVariantById(productId, getLoopWidgetVariantId(productId));
            const sellingPlan = variant.selling_plan_allocations.find(a => a.selling_plan_id == sellingPlanId);
            const { deliveryFreq, isPrepaid } = getLoopWidgetPrepaidSellingPlanDeliveryFreq(productId, sellingPlan.selling_plan_id);
            const value = storeJson.presetBundleShopifyProductIds?.includes(productId) ? getLoopWidgetBundlePriceBySellingPlanId(productId, sellingPlanId, false) || sellingPlan.price / deliveryFreq : sellingPlan.price / deliveryFreq;
            document.getElementById(`loop-widget-purchase-option-price-id-${sellingPlanGroupId}`).innerHTML = loopWidgetFormatPrice(value);
            if (isPrepaid && getLoopWidgetPreferenceByKey(productId, "showFullPriceForPrepaidPlans")) {
                const text = getLoopWidgetTextsByKey(productId, "prepaidFullPriceText").replace("{{prepaid_price}}", loopWidgetFormatPrice(sellingPlan.price)).replace("{{deliveries_per_charge}}", deliveryFreq)
                document.getElementById(`loop-widget-purchase-option-total-prepaid-price-id-${sellingPlanGroupId}`).innerHTML = text;
            }
        }

        changeSellingPlanGroupDiscount(sellingPlanId, productId, sellingPlanGroupId) {
            const variant = getLoopWidgetVariantById(productId, getLoopWidgetVariantId(productId));
            const sellingPlanGroup = window.LOOP_WIDGET[productId]['product'].selling_plan_groups.find(g => g.id === sellingPlanGroupId);
            const sellingPlan = sellingPlanGroup.selling_plans.find(p => p.id == sellingPlanId);
            const { discount, discountText } = getLoopWidgetDiscount(productId, sellingPlan, variant);
            const discEle = document.getElementById(`loop-widget-purchase-option-discount-badge-id-${sellingPlanGroupId}`);
            if (discEle) {
                discEle.innerHTML = `${getLoopWidgetTextsByKey(productId, "discountBadgeText").replace("{{discount_value}}", `${discountText}`)}`;
                if (discount > 0) {
                    discEle.classList.remove("loop-display-none")
                } else {
                    discEle.classList.add("loop-display-none")
                }
            }
        }

        changeSellingPlanGroupDescription(productId, sellingPlanGroupId, sellingPlanId) {
            const sellingPlanGroup = window.LOOP_WIDGET[productId]['product'].selling_plan_groups.find(g => g.id === sellingPlanGroupId);
            const sellingPlan = sellingPlanGroup.selling_plans.find(p => p.id === Number(sellingPlanId));
            const description = sellingPlan?.description || "";
            const descriptionEle = document.getElementById(`loop-widget-sp-selector-description-id-${sellingPlanGroupId}`);
            if (descriptionEle) {
                descriptionEle.innerHTML = description;
            } else {
                const spgContainer = document.getElementById(`loop-widget-container-id-${productId}`)?.querySelector('.loop-w-btn-group-description-container');
                if (spgContainer) {
                    spgContainer.innerHTML = spgContainer.innerHTML + this.generateSellingPlanDescription(sellingPlanGroupId, description);
                }
            }
        }

        removeSpgSelected(productId) {
            document.getElementById(`loop-widget-container-id-${productId}`).querySelectorAll(".loop-w-btn-group-purchase-option").forEach(ele => ele.classList.remove('loop-w-btn-group-purchase-option-selected'));
        }

        removeSpSelectedButtons(productId) {
            if (!getLoopWidgetPreferenceByKey(productId, "sellingPlanFrequencyOptions")) {
                return;
            }
            const widgetContainer = document.getElementById(`loop-widget-container-id-${productId}`);
            if (widgetContainer) {
                const spEls = widgetContainer.querySelectorAll(`.loop-widget-sp-button-selected`);
                if (spEls.length > 0) {
                    spEls.forEach((spEle) => {
                        spEle.classList.remove('loop-widget-sp-button-selected');
                    });
                }
            }
        }
    }

    // CHECKBOX LAYOUT
    class CheckboxLayout {
        constructor(productId) {
            this.productId = productId;
            this.sellingPlanGroups = [getVariantSellingPlanGroups(productId, getLoopWidgetVariantId(productId))[0]];
        }

        // ***************** Main Widget Generation (Entry Points) *****************
        initCheckboxLayout(productId) {
            const variantId = getLoopWidgetVariantId(productId);
            this.generateLoopWidget(productId, variantId);
            this.selectPurchaseOption(productId);
            this.updateDropdownArrowSVG(productId);
            this.attachEventListeners();
            this.addMarginTopOnWidgetContainer(productId);
        }

        addMarginTopOnWidgetContainer(productId) {
            const widgetContainer = document.getElementById(`loop-widget-container-id-${productId}`);
            widgetContainer.style.marginTop = '20px';
        }

        setSvgDimensions(productId) {
            const svgList = document.getElementById(`loop-widget-container-id-${productId}`).querySelectorAll('.loop-w-checkbox-svg');
            svgList.forEach(svg => {
                const width = getComputedStyle(document.documentElement).getPropertyValue('--loop-widget-purchase-option-checkbox-width');
                const height = getComputedStyle(document.documentElement).getPropertyValue('--loop-widget-purchase-option-checkbox-height');
                svg.setAttribute('width', width.trim());
                svg.setAttribute('height', height.trim());
            });
        }

        generateLoopWidget(productId, variantId) {
            const loopWidgetContainer = document.getElementById(`loop-widget-container-id-${productId}`);
            if (!loopWidgetContainer) return;

            const requires_selling_plan = window.LOOP_WIDGET[productId].product.requires_selling_plan;
            let availableSellingPlanGroups = this.sellingPlanGroups;
            if (requires_selling_plan && getLoopWidgetPreferenceByKey(productId, "hideWidgetIfOnePlanAvailable") && availableSellingPlanGroups.length === 1) {
                hideLoopWidget(productId, "generateLoopWidget", "hideWidgetIfOnePlanAvailable and selling plan groups length is 1");
            }

            // ${this.generatePurchaseOptionsLabel(productId)}
            loopWidgetContainer.innerHTML = `
                ${this.generatePurchaseOptions(productId, variantId)}
                ${this.generatePurchaseOptionsDescription(productId)}
                ${this.generateTooltip(productId)}
            `;
        }

        generatePurchaseOptions(productId, variantId) {
            return `
                <div class="loop-w-checkbox-purchase-options-container">
                    ${this.generateSellingPlanContainer(productId, variantId)}
                </div>
            `;
        }

        // ***************** Container Generation (High-level HTML) ******************
        generatePurchaseOptionsLabel(productId) {
            return getLoopWidgetPreferenceByKey(productId, "showPurchaseOptionsLabel") ? `<div class="loop-w-checkbox-purchase-options-label">${getLoopWidgetTextsByKey(productId, "purchaseOptionLabel")}</div>` : '';
        }

        generateSellingPlanContainer(productId, variantId) {
            let availableSellingPlanGroups = this.sellingPlanGroups;
            if (availableSellingPlanGroups.length === 0) {
                hideLoopWidget(productId, "generateSellingPlanContainer", "availableSellingPlanGroups length is 0");
            }

            return this.getSellingPlanContainerTemplate(productId, availableSellingPlanGroups);
        }

        getSubscriptionDescription(productId) {
            let availableSellingPlanGroups = this.sellingPlanGroups;
            const selectedSpgId = window.LOOP_WIDGET[productId]['selectedSellingPlanGroupId'] ?? this.sellingPlanGroups[0].id;

            const sellingPlanGroup = availableSellingPlanGroups.find(spg => spg.id === selectedSpgId);
            if (!sellingPlanGroup) {
                return '';
            }

            return `<div class="loop-w-checkbox-frequency-selector-container">
                ${sellingPlanGroup.selling_plans.length > 0 ? this.generateSellingPlanSelectorAndDesc(productId, sellingPlanGroup, sellingPlanGroup.id, sellingPlanGroup.selling_plans) : ''}
            </div>`
        }

        generatePurchaseOptionsDescription(productId) {
            return `<div id="loop-w-checkbox-description-id-${productId}" class="loop-w-checkbox-description-container loop-display-none"></div>`;
        }

        getSellingPlanContainerTemplate(productId, availableSellingPlanGroups) {
            return availableSellingPlanGroups.map(sellingPlanGroup => `
            <div data-loop-widget-selling-plan-group data-selling-plan-group-id=${sellingPlanGroup.id} id="loop-widget-purchase-option-id-${sellingPlanGroup.id}" class="loop-w-checkbox-purchase-option">
                <div class="loop-w-checkbox-purchase-option-header">
                    <div class="loop-w-checkbox-label-container">
                        ${this.generateSpgLabel(sellingPlanGroup.id, sellingPlanGroup.name)}
                        ${this.generatePurchaseOptionDiscountBadge(productId, sellingPlanGroup.id)}
                    </div>
                    <div class="loop-w-checkbox-price-container">
                        ${this.generatePurchaseOptionPriceContainer(productId, sellingPlanGroup.id)}
                    </div>
                </div>
                ${this.generatePurchaseOptionPriceContainerPrepaid(productId, sellingPlanGroup.id)}
            </div>`).join(" ");
        }

        // ***************** Selling Plan HTML Generation ******************
        generateSellingPlanSelectorAndDesc(productId, sellingPlanGroup, sellingPlanGroupId, selling_plans) {
            const variantSellingPlans = loopWidgetGetVariantSpgSellingPlans(productId, sellingPlanGroupId);
            const filteredSPforVariant = selling_plans.filter(sp => variantSellingPlans.includes(sp.id));

            return this.generateLoopWidgetSpSelectorTemplate(productId, sellingPlanGroup, sellingPlanGroupId, filteredSPforVariant);
        }

        generatePlanSelectors(productId, sellingPlanGroup, sellingPlanGroupId, selling_plans) {
            const label = sellingPlanGroup?.options?.[0]?.name ?? "";

            if (getLoopWidgetPreferenceByKey(productId, "showPlanSelectorAsTextIfOnePlanAvailable") && selling_plans.length === 1) {
                return this.generateSpSelectorAsText(selling_plans, label, getLoopWidgetPreferenceByKey(productId, "sellingPlanFrequencyOptions") === "BUTTON");
            }

            if (selling_plans.length === 1) {
                return '';
            }

            if (getLoopWidgetPreferenceByKey(productId, "sellingPlanFrequencyOptions") === "BUTTON") {
                return this.generatePlanSelectorAsButton(productId, sellingPlanGroupId, selling_plans, label);
            }

            return this.generateSpSelectorAsDropdown(productId, sellingPlanGroupId, selling_plans, label);
        }

        generateLoopWidgetSpSelectorTemplate(productId, sellingPlanGroup, sellingPlanGroupId, filteredSPforVariant) {
            const description = filteredSPforVariant[0]?.description || "";

            return `
            <div id="loop-widget-spg-container-id-${sellingPlanGroupId}" class="loop-w-checkbox-description-subscription">
                ${this.generatePlanSelectors(productId, sellingPlanGroup, sellingPlanGroupId, filteredSPforVariant)}
                ${description ? this.generateSellingPlanDescription(sellingPlanGroupId, description) : ''}
            </div>`
        }

        generatePlanSelectorAsButton(productId, sellingPlanGroupId, selling_plans, label) {
            return `<div class="loop-w-checkbox-sp-button-selector-wrapper">
            <div class="loop-w-checkbox-sp-button-selector-label">${label}</div>
            <div id="loop-widget-sp-button-group-id-${sellingPlanGroupId}" class="loop-widget-sp-button-container">
                ${selling_plans.map(sp => this.generateSellingPlanButton(sp, productId, sellingPlanGroupId)).join('')}
            </div>
        </div>`
        }

        generateSpSelectorAsDropdown(productId, sellingPlanGroupId, selling_plans, label) {
            return `
          <div class="loop-widget-sp-selector-wrapper">
            <div class="loop-widget-sp-selector-label">${label}</div>
            <div class="loop-widget-sp-selector-container">
              <select id="loop-widget-sp-selector-dropdown-${sellingPlanGroupId}" data-selling-plan-group-id=${sellingPlanGroupId} class="loop-widget-sp-selector" name="selling_plan">
                ${selling_plans.map(this.generateSellingPlan).join('')}
              </select>
            </div>
          </div>`;
        }

        generateSpSelectorAsText(selling_plans, label, isBtnLabel) {
            const classNames = `loop-widget-sp-selector-label-as-text loop-widget-left-padding-0${isBtnLabel ? " loop-widget-sp-selector-btn-label-as-text" : ""}`;
            return `<div class="loop-widget-sp-selector-wrapper">
                <div class="${classNames}"><span class="loop-widget-sp-selector-as-text-label">${label}: </span><span class="loop-widget-sp-option">${selling_plans[0].name}</span></div>
            </div>`
        }

        generateSellingPlan(sp) {
            return `<option class="loop-widget-sp-option" value="${sp.id}">${sp.options[0].value ?? sp.name}</option>`;
        }

        generateSellingPlanButton(sp, productId, sellingPlanGroupId) {
            return `<div id="loop-widget-sp-button-id-${sp.id}" data-selling-plan-group-id=${sellingPlanGroupId} data-selling-plan-id=${sp.id} class="loop-widget-sp-button">
               ${sp.options[0].value ?? sp.name}
        </div>`;
        }

        generateSellingPlanDescription(sellingPlanGroupId, description) {
            return `
            <div class="loop-widget-sp-selector-description-wrapper">
                <div id="loop-widget-sp-selector-description-id-${sellingPlanGroupId}" class="loop-w-checkbox-purchase-option-description-text">${description}</div>
            </div>`;
        }

        // ******************** Price & Discount HTML Generation ******************
        generatePurchaseOptionPriceContainer(productId, sellingPlanGroupId) {
            const storeJson = window.LOOP_WIDGET[productId]['storeJson'];
            const variant = getLoopWidgetVariantById(productId, getLoopWidgetVariantId(productId));
            const sellingPlans = loopWidgetGetVariantSpgSellingPlans(productId, sellingPlanGroupId);
            const sellingPlan = variant.selling_plan_allocations.find(a => a.selling_plan_id === sellingPlans[0]);
            const { deliveryFreq, isPrepaid } = getLoopWidgetPrepaidSellingPlanDeliveryFreq(productId, sellingPlan.selling_plan_id);
            const originalPrice = LOOP_WIDGET_USE_COMPARE_AT_PRICE ? variant.compare_at_price : variant.price;
            const price = storeJson.presetBundleShopifyProductIds.includes(productId) ? getLoopWidgetBundlePriceBySellingPlanId(productId, sellingPlan.selling_plan_id, false) || sellingPlan.price / deliveryFreq : sellingPlan.price / deliveryFreq;
            const totalPrepaidPrice = sellingPlan.price;
            return this.getPurchaseOptionPriceTemplate(productId, sellingPlanGroupId, originalPrice, price, totalPrepaidPrice, deliveryFreq, isPrepaid);
        }

        generatePurchaseOptionPriceContainerPrepaid(productId, sellingPlanGroupId) {
            const storeJson = window.LOOP_WIDGET[productId]['storeJson'];
            const variant = getLoopWidgetVariantById(productId, getLoopWidgetVariantId(productId));
            const sellingPlans = loopWidgetGetVariantSpgSellingPlans(productId, sellingPlanGroupId);
            const sellingPlan = variant.selling_plan_allocations.find(a => a.selling_plan_id === sellingPlans[0]);
            const { deliveryFreq, isPrepaid } = getLoopWidgetPrepaidSellingPlanDeliveryFreq(productId, sellingPlan.selling_plan_id);
            const originalPrice = LOOP_WIDGET_USE_COMPARE_AT_PRICE ? variant.compare_at_price : variant.price;
            const price = storeJson.presetBundleShopifyProductIds.includes(productId) ? getLoopWidgetBundlePriceBySellingPlanId(productId, sellingPlan.selling_plan_id, false) || sellingPlan.price / deliveryFreq : sellingPlan.price / deliveryFreq;
            const totalPrepaidPrice = sellingPlan.price;
            return this.getPurchaseOptionPriceTemplatePrepaid(productId, sellingPlanGroupId, originalPrice, price, totalPrepaidPrice, deliveryFreq, isPrepaid);
        }

        getPurchaseOptionPriceTemplate(productId, sellingPlanGroupId, originalPrice, price, totalPrepaidPrice, deliveryFreq, isPrepaid) {
            return `
            <div class="loop-w-checkbox-purchase-option-price-each-container">
                <div class="loop-w-checkbox-purchase-option-price-container">
                    ${originalPrice === price || !getLoopWidgetPreferenceByKey(productId, "showCompareAtPrice") ? '' : `<div class="loop-w-btn-group-purchase-option-compare-at-price">${loopWidgetFormatPrice(originalPrice)}</div>`}
                    <div id="loop-widget-purchase-option-price-id-${sellingPlanGroupId}" class="loop-w-checkbox-purchase-option-price">${loopWidgetFormatPrice(price)}</div>
                    ${!getLoopWidgetPreferenceByKey(productId, "hideEachLabel") && !isPrepaid ? `<div class="loop-w-checkbox-purchase-option-each-label">${getLoopWidgetTextsByKey(productId, "priceLabelText")}</div>` : ''}
                </div>
            </div>
            `
        }

        getPurchaseOptionPriceTemplatePrepaid(productId, sellingPlanGroupId, originalPrice, price, totalPrepaidPrice, deliveryFreq, isPrepaid) {
            return `
            ${this.getPrepaidPriceOrEachText(productId, isPrepaid, deliveryFreq, totalPrepaidPrice, sellingPlanGroupId)}
            `
        }

        generatePurchaseOptionDiscountBadge(productId, sellingPlanGroupId) {
            const variant = getLoopWidgetVariantById(productId, getLoopWidgetVariantId(productId));
            const variantSellingPlans = loopWidgetGetVariantSpgSellingPlans(productId, sellingPlanGroupId);
            const firstSellingPlan = window.LOOP_WIDGET[productId]['product'].selling_plan_groups.find(g => g.id === sellingPlanGroupId)['selling_plans'].find(sp => sp.id === variantSellingPlans[0]);
            const { discount, discountText } = getLoopWidgetDiscount(productId, firstSellingPlan, variant);
            const discText = getLoopWidgetTextsByKey(productId, "discountBadgeText")?.replace("{{discount_value}}", `${discountText}`);
            return getLoopWidgetPreferenceByKey(productId, "showDiscountBadgeForSubscription") ? `<div id="loop-widget-purchase-option-discount-badge-id-${sellingPlanGroupId}" class="loop-w-checkbox-purchase-option-discount-badge${discount > 0 ? '' : ' loop-display-none'}">${discText}</div>` : '';
        }

        getPrepaidPriceOrEachText(productId, isPrepaid, deliveryFreq, totalPrepaidPrice, sellingPlanGroupId) {
            if (isPrepaid && getLoopWidgetPreferenceByKey(productId, "showFullPriceForPrepaidPlans")) {
                return `<div id="loop-widget-purchase-option-total-prepaid-price-id-${sellingPlanGroupId}" class="loop-w-checkbox-purchase-option-total-prepaid-price">${getLoopWidgetTextsByKey(productId, "prepaidFullPriceText").replace("{{prepaid_price}}", loopWidgetFormatPrice(totalPrepaidPrice)).replace("{{deliveries_per_charge}}", deliveryFreq)}</div>`
            }

            return ''

            // return `${!getLoopWidgetPreferenceByKey(productId, "hideEachLabel") ? `<div class="loop-w-checkbox-purchase-option-each-label">${getLoopWidgetTextsByKey(productId, "priceLabelText")}</div>` : ''}`
        }

        // ********************* UI Components & SVG Generation ******************
        generateSpgLabel(productId, name) {
            return `
                <div class="loop-w-checkbox-purchase-option-label-container">
                    <div id="loop-w-checkbox-id-${productId}" class="loop-w-purchase-option-checkbox">
                        ${this.getCheckbox(null)}
                    </div>
                    <div class="loop-w-checkbox-purchase-option-label">${name}</div>
                </div>
            `;
        }

        getCheckbox(selectedSellingPlanGroupId) {
            if (!selectedSellingPlanGroupId) {
                return `<svg class="loop-w-checkbox-svg" fill="var(--loop-widget-purchase-option-checkbox-accent-color)" xmlns="http://www.w3.org/2000/svg" width="30px" height="30px" viewBox="0 0 24 24">
                            <g fill-rule="nonzero">
                                <path d="M6,3 L18,3 C19.6568542,3 21,4.34314575 21,6 L21,18 C21,19.6568542 19.6568542,21 18,21 L6,21 C4.34314575,21 3,19.6568542 3,18 L3,6 C3,4.34314575 4.34314575,3 6,3 Z M6,5 C5.44771525,5 5,5.44771525 5,6 L5,18 C5,18.5522847 5.44771525,19 6,19 L18,19 C18.5522847,19 19,18.5522847 19,18 L19,6 C19,5.44771525 18.5522847,5 18,5 L6,5 Z"></path>
                            </g>
                    </svg>`;
            }

            return `<svg class="loop-w-checkbox-svg" fill="var(--loop-widget-purchase-option-checkbox-accent-color)" xmlns="http://www.w3.org/2000/svg" width="30px" height="30px" viewBox="0 0 24 24">
                    <g fill-rule="nonzero">
                        <path d="M18,3 C19.6568542,3 21,4.34314575 21,6 L21,18 C21,19.6568542 19.6568542,21 18,21 L6,21 C4.34314575,21 3,19.6568542 3,18 L3,6 C3,4.34314575 4.34314575,3 6,3 L18,3 Z M16.4696699,7.96966991 L10,14.4393398 L7.53033009,11.9696699 C7.23743687,11.6767767 6.76256313,11.6767767 6.46966991,11.9696699 C6.1767767,12.2625631 6.1767767,12.7374369 6.46966991,13.0303301 L9.46966991,16.0303301 C9.76256313,16.3232233 10.2374369,16.3232233 10.5303301,16.0303301 L17.5303301,9.03033009 C17.8232233,8.73743687 17.8232233,8.26256313 17.5303301,7.96966991 C17.2374369,7.6767767 16.7625631,7.6767767 16.4696699,7.96966991 Z"></path>
                    </g>
            </svg>`;
        }

        generateTooltip(productId) {
            return getLoopWidgetPreferenceByKey(productId, "showSubscriptionDetailsPopup") ? `
            <div class="loop-w-checkbox-tooltip-container loop-display-none">
                <div class="loop-widget-tooltip-header">
                    <div class="loop-widget-tooltip-image">
                        <svg width="15" height="15" viewBox="0 0 90 90" xmlns="http://www.w3.org/2000/svg" class="loop-widget-tooltip-svg">
                            <path d="M45 0C20.1827 0 0 20.1827 0 45C0 69.8173 20.1827 90 45 90C69.8173 90 90 69.8174 90 45C90.0056 44.6025 89.9322 44.2078 89.7839 43.8389C89.6357 43.47 89.4156 43.1342 89.1365 42.8511C88.8573 42.568 88.5247 42.3432 88.158 42.1897C87.7912 42.0363 87.3976 41.9573 87 41.9573C86.6024 41.9573 86.2088 42.0363 85.842 42.1897C85.4753 42.3432 85.1427 42.568 84.8635 42.8511C84.5844 43.1342 84.3643 43.47 84.2161 43.8389C84.0678 44.2078 83.9944 44.6025 84 45C84 66.5748 66.5747 84 45 84C23.4253 84 6 66.5747 6 45C6 23.4254 23.4253 6 45 6C56.1538 6 66.3012 10.5882 73.4375 18H65.4062C65.0087 17.9944 64.614 18.0678 64.2451 18.2161C63.8762 18.3643 63.5405 18.5844 63.2573 18.8635C62.9742 19.1427 62.7494 19.4753 62.596 19.842C62.4425 20.2088 62.3635 20.6024 62.3635 21C62.3635 21.3976 62.4425 21.7912 62.596 22.158C62.7494 22.5247 62.9742 22.8573 63.2573 23.1365C63.5405 23.4156 63.8762 23.6357 64.2451 23.7839C64.614 23.9322 65.0087 24.0056 65.4062 24H79.8125C80.6081 23.9999 81.3711 23.6838 81.9337 23.1212C82.4963 22.5586 82.8124 21.7956 82.8125 21V6.59375C82.821 6.18925 82.7476 5.78722 82.5966 5.41183C82.4457 5.03644 82.2205 4.69545 81.9344 4.40936C81.6483 4.12327 81.3073 3.898 80.9319 3.7471C80.5565 3.5962 80.1545 3.52277 79.75 3.53125C79.356 3.53941 78.9675 3.62511 78.6067 3.78344C78.2458 3.94177 77.9197 4.16963 77.6469 4.45402C77.3741 4.73841 77.16 5.07375 77.0168 5.44089C76.8737 5.80803 76.8042 6.19977 76.8125 6.59375V12.875C68.6156 4.86282 57.3081 0 45 0ZM43.75 20.75C43.356 20.7582 42.9675 20.8439 42.6067 21.0022C42.2458 21.1605 41.9197 21.3884 41.6469 21.6728C41.3741 21.9572 41.16 22.2925 41.0168 22.6596C40.8737 23.0268 40.8042 23.4185 40.8125 23.8125V47.375C40.8116 47.7693 40.8883 48.16 41.0385 48.5246C41.1886 48.8892 41.4092 49.2207 41.6875 49.5L54.0938 61.9375C54.6573 62.5011 55.4217 62.8177 56.2188 62.8177C57.0158 62.8177 57.7802 62.5011 58.3438 61.9375C58.9073 61.3739 59.224 60.6095 59.224 59.8125C59.224 59.0155 58.9073 58.2511 58.3438 57.6875L46.8125 46.1875V23.8125C46.821 23.408 46.7476 23.006 46.5966 22.6306C46.4457 22.2552 46.2205 21.9142 45.9344 21.6281C45.6483 21.342 45.3073 21.1168 44.9319 20.9658C44.5565 20.8149 44.1545 20.7415 43.75 20.75Z"></path>
                        </svg>
                    </div>
                    <div class="loop-widget-tooltip-label">${getLoopWidgetTextsByKey(productId, "subscriptionDetailsText")}</div>
                </div>
                <div class="loop-widget-tooltip-text">
                    <div class="loop-widget-container-arrow"></div>
                    <div>${getLoopWidgetTextsByKey(productId, "subscriptionDetailsDescription")}</div>
                </div>
            </div>` : '';
        }

        updateDropdownArrowSVG() {
            const color = getComputedStyle(document.documentElement).getPropertyValue('--loop-widget-dropdown-arrow-svg-stroke-color').trim();
            const height = getComputedStyle(document.documentElement).getPropertyValue('--loop-widget-dropdown-arrow-svg-height').trim();
            const width = getComputedStyle(document.documentElement).getPropertyValue('--loop-widget-dropdown-arrow-svg-width').trim();

            const finalColor = color || '#000';
            const finalHeight = height || '30px';
            const finalWidth = width || '30px';

            const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${finalWidth}' height='${finalHeight}' viewBox='0 0 24 24' fill='none'><path d='M17 9.5L12 14.5L7 9.5' stroke='${finalColor}' stroke-linecap='round' stroke-linejoin='round'/></svg>`;
            const encodedSVG = encodeURIComponent(svg);

            const styleContent = `.loop-widget-sp-selector-container::after { background-image: url("data:image/svg+xml;utf8,${encodedSVG}"); background-size: contain; }`;
            let style = document.getElementById('loop-widget-dropdown-arrow-svg');
            if (!style) {
                style = document.createElement('style');
                style.id = 'loop-widget-dropdown-arrow-svg';
                document.body.appendChild(style);
            }
            style.textContent = styleContent;
        }

        // ********************** Event Handling & User Interactions ******************
        attachEventListeners() {
            const productId = this.productId;
            const container = document.getElementById(`loop-widget-container-id-${productId}`);
            if (!container) return;

            // Selling Plan Group container (click event)
            const spgContainers = container.querySelectorAll('[data-loop-widget-selling-plan-group]');
            spgContainers.forEach(spg => {
                spg.addEventListener('click', (event) => {
                    const groupId = spg.dataset.sellingPlanGroupId;
                    const groupContainer = document.getElementById(`loop-widget-container-id-${productId}`)?.querySelector(`#loop-widget-purchase-option-id-${groupId}`);
                    if (groupContainer.classList.contains('loop-widget-purchase-option-selected')) {
                        this.handleLoopWidgetOnetimeClick(productId);
                    } else {
                        this.handleLoopWidgetSellingPlanGroupChange(productId, groupId, event);
                    }
                });
            });
        }

        attachSellingPlanListener(productId) {
            const container = document.getElementById(`loop-widget-container-id-${productId}`);
            if (!container) return;

            const sellingPlanSelectors = container.querySelectorAll('.loop-widget-sp-selector');
            sellingPlanSelectors.forEach(select => {
                select.addEventListener('change', (event) => {
                    const groupId = select.dataset.sellingPlanGroupId;
                    this.handleLoopWidgetSellingPlanChange(event, productId, groupId);
                });
            });

            // Selling Plan Buttons (click event)
            const sellingPlanButtons = container.querySelectorAll('.loop-widget-sp-button');
            sellingPlanButtons.forEach(button => {
                button.addEventListener('click', (event) => {
                    const groupId = button.dataset.sellingPlanGroupId;
                    this.handleLoopWidgetSellingPlanChange(event, productId, groupId);
                });
            });
        }

        handleLoopWidgetSellingPlanChange(event, productId, sellingPlanGroupId) {
            if (event.stopPropagation) {
                event.stopPropagation();
            }

            const selectedSpgId = window.LOOP_WIDGET[productId]['selectedSellingPlanGroupId'];
            if (selectedSpgId !== sellingPlanGroupId) {
                this.handleLoopWidgetSellingPlanGroupChange(productId, sellingPlanGroupId, event);
                return;
            }

            const sellingPlanId = event.target.value ?? Number(event.target.dataset.sellingPlanId);
            window.LOOP_WIDGET[productId]['selectedSellingPlanId'] = sellingPlanId;
            handleLoopWidgetSellingPlanValue(productId, sellingPlanId, true);
            this.changeSellingPlanGroupPrice(sellingPlanId, productId, sellingPlanGroupId);
            this.changeSellingPlanGroupDiscount(sellingPlanId, productId, sellingPlanGroupId);
            this.changeSellingPlanGroupDescription(productId, sellingPlanGroupId, sellingPlanId);
            this.markSelectedFlagOnSellingPlan(productId, sellingPlanId, sellingPlanGroupId);
            this.handleDescriptionContainer(productId);
        }

        handleDescriptionContainer(productId) {
            let availableSellingPlanGroups = this.sellingPlanGroups;
            const selectedSpgId = window.LOOP_WIDGET[productId]['selectedSellingPlanGroupId'];
            const selectedSpId = window.LOOP_WIDGET[productId]['selectedSellingPlanId'];

            const sellingPlanGroup = availableSellingPlanGroups.find(spg => spg.id === selectedSpgId) || availableSellingPlanGroups[0];
            const selling_plans = sellingPlanGroup.selling_plans;

            const variantSellingPlans = loopWidgetGetVariantSpgSellingPlans(productId, selectedSpgId ?? sellingPlanGroup.id);
            const filteredSPforVariant = selling_plans.filter(sp => variantSellingPlans.includes(sp.id));
            const description = filteredSPforVariant?.find(sp => sp.id === selectedSpId)?.description || "";
            const show = description && description.length > 0 || filteredSPforVariant.length > 1 || getLoopWidgetPreferenceByKey(productId, "showPlanSelectorAsTextIfOnePlanAvailable");

            const descContainer = document.getElementById(`loop-widget-container-id-${productId}`)?.querySelector('.loop-w-checkbox-description-container');
            const tooltipContainer = document.getElementById(`loop-widget-container-id-${productId}`)?.querySelector('.loop-w-checkbox-tooltip-container');
            if (descContainer) {
                // (getLoopWidgetPreferenceByKey(productId, "alwaysShowSellingPlanDetails") && show && !selectedSpgId)
                if (show && selectedSpgId) {
                    descContainer.classList.remove("loop-display-none");
                    tooltipContainer?.classList?.remove("loop-display-none");
                } else {
                    descContainer.classList.add("loop-display-none");
                    tooltipContainer?.classList?.add("loop-display-none");
                }
            }

            const ele = document.getElementById(`loop-widget-container-id-${productId}`)?.querySelector('.loop-w-checkbox-description-container');
            if (!description) {
                if (ele) {
                    ele.style.gap = '0px';
                }
            } else {
                if (ele) {
                    ele.style.gap = '7px';
                }
            }
        }

        handleLoopWidgetOnetimeClick(productId) {
            window.LOOP_WIDGET[productId]['selectedSellingPlanGroupId'] = null;
            this.handleWidgetCheckbox(productId, null);
            this.removeLoopWidgetSpgSelected(productId);
            this.removeSpSelectedButtons(productId);
            this.addDescription(productId, this.sellingPlanGroups[0].id);
            this.handleDescriptionContainer(productId);
            this.setSvgDimensions(productId)
            handleLoopWidgetSellingPlanValue(productId, null, false);
            loopWidgetUpdateAddToCartButtonText(productId);
        }

        removeLoopWidgetSpgSelected(productId) {
            document.getElementById(`loop-widget-container-id-${productId}`).querySelectorAll(".loop-w-checkbox-purchase-option").forEach(ele => ele.classList.remove('loop-widget-purchase-option-selected'));
        }

        handleLoopWidgetSellingPlanGroupChange(productId, groupId, event) {
            window.LOOP_WIDGET[productId]['selectedSellingPlanGroupId'] = groupId;
            const variantSellingPlans = loopWidgetGetVariantSpgSellingPlans(productId, groupId);
            handleLoopWidgetSellingPlanValue(productId, this.getSelectedPlanIdForGroup(productId, groupId) ?? variantSellingPlans[0], true);
            loopWidgetUpdateAddToCartButtonText(productId);
            this.addSelectedClassOnPurchaseOption(productId, groupId);
            this.handleWidgetCheckbox(productId, groupId);
            this.addDescription(productId, groupId);
            this.setSvgDimensions(productId)
        }

        addSelectedClassOnPurchaseOption(productId, groupId) {
            const container = document.getElementById(`loop-widget-container-id-${productId}`)?.querySelector(`#loop-widget-purchase-option-id-${groupId}`);
            if (container) {
                container.classList.add("loop-widget-purchase-option-selected");
            }
        }

        addDescription(productId, groupId) {
            const spgContainer = document.getElementById(`loop-widget-container-id-${productId}`)?.querySelector('.loop-w-checkbox-description-container');
            if (spgContainer) {
                spgContainer.innerHTML = this.getSubscriptionDescription(productId);
                this.selectDefaultPlanForGroup(productId, groupId);
                this.attachSellingPlanListener(productId);
                this.handleDescriptionContainer(productId);
            }
        }

        handleWidgetCheckbox(productId, groupId) {
            // check checkbox
            const spgCheckbox = document.getElementById(`loop-widget-container-id-${productId}`)?.querySelector(`.loop-w-purchase-option-checkbox`);
            if (spgCheckbox) {
                spgCheckbox.innerHTML = this.getCheckbox(groupId);
            }
        }

        // ********************* Selection & State Management ******************
        selectPurchaseOption(productId) {
            const variantSellingPlanGroups = getVariantSellingPlanGroups(productId, getLoopWidgetVariantId(productId));
            const spgIdToSelect = getPreviousSpgSelectedForVariant(productId, variantSellingPlanGroups);
            const requires_selling_plan = window.LOOP_WIDGET[productId].product.requires_selling_plan;

            if ((getLoopWidgetPreferenceByKey(productId, "purchaseOptionLabel") === "Subscription" && variantSellingPlanGroups.length) || spgIdToSelect || getLoopWidgetProductBundleData(productId).purchaseType === "SUBSCRIPTION" || requires_selling_plan) {
                this.handleLoopWidgetSellingPlanGroupChange(productId, spgIdToSelect ?? variantSellingPlanGroups[0]?.id);
                this.selectDefaultPlanForGroup(productId, spgIdToSelect ?? variantSellingPlanGroups[0]?.id);
            } else {
                this.handleLoopWidgetOnetimeClick(productId);
            }
        }

        selectDefaultPlanForGroup(productId, groupId) {
            try {
                const storeDefaultSellingPlanShopifyIds = getStoreDefaultSellingPlanShopifyIds(productId);
                if (!storeDefaultSellingPlanShopifyIds.length) return;
                const selectedVariantId = getLoopWidgetVariantId(productId);
                const selectedGroupSellingPlanShopifyIds = window.LOOP_WIDGET[productId]['variantToSellingPlans'][selectedVariantId][groupId];
                const defaultSellingPlanShopifyId = getCommonElements(storeDefaultSellingPlanShopifyIds, selectedGroupSellingPlanShopifyIds)?.[0];
                if (defaultSellingPlanShopifyId && window.LOOP_WIDGET[productId]['selectedSellingPlanGroupId']) {
                    this.handleLoopWidgetSellingPlanChange({ target: { value: defaultSellingPlanShopifyId } }, productId, groupId);
                }
                this.selectDefaultPlanForAllGroups(productId, selectedVariantId);
            } catch (error) {
                widgetLogger("Could not select default plan", error);
            }
        }

        selectDefaultPlanForAllGroups(productId, selectedVariantId) {
            const variantSellingPlanGroups = window.LOOP_WIDGET[productId]['variantToSellingPlans'][selectedVariantId];
            const storeDefaultSellingPlanShopifyIds = getStoreDefaultSellingPlanShopifyIds(productId);
            for (const groupId in variantSellingPlanGroups) {
                const groupSpIds = variantSellingPlanGroups[groupId];
                if (groupSpIds.length) {
                    const defaultSellingPlanShopifyId = getCommonElements(storeDefaultSellingPlanShopifyIds, groupSpIds)?.[0];
                    if (defaultSellingPlanShopifyId) {
                        changeDropdownValueBySelectId(`loop-widget-sp-selector-dropdown-${groupId}`, defaultSellingPlanShopifyId);
                    }
                }
            }
        }

        getSelectedPlanIdForGroup(productId, sellingPlanGroupId) {
            const widgetContainer = document.getElementById(`loop-widget-container-id-${productId}`);
            if (widgetContainer) {
                const spgEle = widgetContainer.querySelector(`#loop-widget-purchase-option-id-${sellingPlanGroupId}`);
                if (spgEle) {
                    const selectedOption = spgEle.querySelector(`option.loop-widget-sp-option[data-selected="true"]`);
                    if (selectedOption) {
                        return Number(selectedOption.value);
                    }
                }
            }
            return null;
        }

        markSelectedFlagOnSellingPlan(productId, sellingPlanId, sellingPlanGroupId) {
            const widgetContainer = document.getElementById(`loop-widget-container-id-${productId}`);
            if (widgetContainer) {
                if (getLoopWidgetPreferenceByKey(productId, "sellingPlanFrequencyOptions") === "BUTTON") {
                    const spEls = widgetContainer.querySelectorAll(`.loop-widget-sp-button`);
                    if (spEls.length > 0) {
                        spEls.forEach((spEle) => {
                            const planId = Number(spEle.dataset.sellingPlanId);
                            if (planId === Number(sellingPlanId)) {
                                spEle.classList.add('loop-widget-sp-button-selected');
                            } else {
                                spEle.classList.remove('loop-widget-sp-button-selected');
                            }
                        });
                    }
                    return;
                }
                const spgEle = widgetContainer.querySelector(`#loop-widget-purchase-option-id-${sellingPlanGroupId}`);
                if (spgEle) {
                    const spEls = spgEle.querySelectorAll(`option.loop-widget-sp-option`);
                    if (spEls.length > 0) {
                        spEls.forEach((spEle) => {
                            if (spEle && spEle.value && Number(spEle.value) === Number(sellingPlanId)) {
                                spEle.setAttribute('data-selected', 'true');
                            } else {
                                spEle.removeAttribute('data-selected');
                            }
                        });
                    }
                }
            }
        }

        // ********************* Dynamic Updates & DOM Manipulation ******************
        changeSellingPlanGroupPrice(sellingPlanId, productId, sellingPlanGroupId) {
            const storeJson = window.LOOP_WIDGET[productId]['storeJson'];
            const variant = getLoopWidgetVariantById(productId, getLoopWidgetVariantId(productId));
            const sellingPlan = variant.selling_plan_allocations.find(a => a.selling_plan_id == sellingPlanId);
            const { deliveryFreq, isPrepaid } = getLoopWidgetPrepaidSellingPlanDeliveryFreq(productId, sellingPlan.selling_plan_id);
            const value = storeJson.presetBundleShopifyProductIds?.includes(productId) ? getLoopWidgetBundlePriceBySellingPlanId(productId, sellingPlanId, false) || sellingPlan.price / deliveryFreq : sellingPlan.price / deliveryFreq;
            document.getElementById(`loop-widget-purchase-option-price-id-${sellingPlanGroupId}`).innerHTML = loopWidgetFormatPrice(value);
            if (isPrepaid && getLoopWidgetPreferenceByKey(productId, "showFullPriceForPrepaidPlans")) {
                const text = getLoopWidgetTextsByKey(productId, "prepaidFullPriceText").replace("{{prepaid_price}}", loopWidgetFormatPrice(sellingPlan.price)).replace("{{deliveries_per_charge}}", deliveryFreq)
                document.getElementById(`loop-widget-purchase-option-total-prepaid-price-id-${sellingPlanGroupId}`).innerHTML = text;
            }
        }

        changeSellingPlanGroupDiscount(sellingPlanId, productId, sellingPlanGroupId) {
            const variant = getLoopWidgetVariantById(productId, getLoopWidgetVariantId(productId));
            const sellingPlanGroup = window.LOOP_WIDGET[productId]['product'].selling_plan_groups.find(g => g.id === sellingPlanGroupId);
            const sellingPlan = sellingPlanGroup.selling_plans.find(p => p.id == sellingPlanId);
            const { discount, discountText } = getLoopWidgetDiscount(productId, sellingPlan, variant);
            const discEle = document.getElementById(`loop-widget-purchase-option-discount-badge-id-${sellingPlanGroupId}`);
            if (discEle) {
                discEle.innerHTML = `${getLoopWidgetTextsByKey(productId, "discountBadgeText").replace("{{discount_value}}", `${discountText}`)}`;
                if (discount > 0) {
                    discEle.classList.remove("loop-display-none")
                } else {
                    discEle.classList.add("loop-display-none")
                }
            }
        }

        changeSellingPlanGroupDescription(productId, sellingPlanGroupId, sellingPlanId) {
            const sellingPlanGroup = window.LOOP_WIDGET[productId]['product'].selling_plan_groups.find(g => g.id === sellingPlanGroupId);
            const sellingPlan = sellingPlanGroup.selling_plans.find(p => p.id === Number(sellingPlanId));
            const description = sellingPlan?.description || "";
            const descriptionEle = document.getElementById(`loop-widget-sp-selector-description-id-${sellingPlanGroupId}`);
            if (descriptionEle) {
                descriptionEle.innerHTML = description;
            } else {
                const spgContainer = document.getElementById(`loop-widget-container-id-${productId}`)?.querySelector('.loop-w-checkbox-description-container');
                if (spgContainer) {
                    spgContainer.innerHTML = spgContainer.innerHTML + this.generateSellingPlanDescription(sellingPlanGroupId, description);
                }
            }
        }

        removeSpSelectedButtons(productId) {
            if (!getLoopWidgetPreferenceByKey(productId, "sellingPlanFrequencyOptions")) {
                return;
            }
            const widgetContainer = document.getElementById(`loop-widget-container-id-${productId}`);
            if (widgetContainer) {
                const spEls = widgetContainer.querySelectorAll(`.loop-widget-sp-button-selected`);
                if (spEls.length > 0) {
                    spEls.forEach((spEle) => {
                        spEle.classList.remove('loop-widget-sp-button-selected');
                    });
                }
            }
        }
    }

    return {
        startLoopWidget,
        handleLoopWidgetVariantIdChange,
        loopWidgetOverrideAddToCartButton,
    };
})();
