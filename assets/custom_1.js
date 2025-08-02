function btdShopifyAccordion(accordion)
{
    var acc = document.getElementsByClassName(accordion);
    var i;
    for (i = 0; i < acc.length; i++) {
        var panel = acc[i].nextElementSibling;
        if (acc[i].classList.contains("Active")) {
            // panel.style.height = (panel.scrollHeight + 2) + "px";
        } else {
            panel.style.height = "0px";
        }
        acc[i].addEventListener("click", function () {
            var panel = this.nextElementSibling;
            this.classList.toggle("Active");
            panel.classList.toggle("show");

            if (panel.classList.contains("show")) {
                panel.style.height = (panel.scrollHeight + 2) + "px";
            } else {
                panel.style.height = "0px";
            }
        });
    }
}

function multiDropdown(accordion)
{
    var acc = document.getElementsByClassName(accordion);
    var i;
    for (i = 0; i < acc.length; i++) {
        var panel = acc[i].nextElementSibling;
        var parent = acc[i].closest('.BtdShopifyCategoryArchiveAccordionContent');
        // if (parent) {
        //     parent.classList.add("show");
        //     parent.style.height = (parent.offsetHeight + panel.scrollHeight) + 'px';
        //     var firstChild = parent.previousElementSibling;
        //     if (firstChild) {
        //         var nextChild = firstChild.nextElementSibling;
        //         firstChild.classList.add("Active");
        //         nextChild.style.height = (panel.scrollHeight + 2) + "px";
        //     }
        // }
        if (acc[i].classList.contains("Active")) {
            panel.style.height = panel.scrollHeight + "px";
        } else {
            panel.style.height = "0px";
        }

        acc[i].addEventListener("click", function (e) {
            e.preventDefault()
            var panel = this.nextElementSibling;
            this.classList.toggle("Active");
            panel.classList.toggle("show");
            var parent = this.closest('.BtdShopifyCategoryArchiveAccordionContent');
            if (panel.classList.contains("show")) {
                panel.style.height = panel.scrollHeight + "px";
            } else {
                panel.style.height = "0px";
            }
            if (parent) {
                if (panel.classList.contains("show")) {
                    parent.style.height = (parent.scrollHeight + panel.scrollHeight) + "px";
                } else {
                    parent.style.height = (parent.scrollHeight - panel.scrollHeight) + "px";
                }
            }
        });
    }
}

