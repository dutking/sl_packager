const path = require('path');
const fs = require('fs-extra');
const HTMLParser = require('node-html-parser');
const AdmZip = require('adm-zip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom')

async function init () {
    let date = new Date();
    let mm = Number(date.getMinutes()).toLocaleString({ minimumIntegerDigits: 2 });
    let hh = Number(date.getHours()).toLocaleString({ minimumIntegerDigits: 2 });
    let day = Number(date.getDate()).toLocaleString({ minimumIntegerDigits: 2 });
    let month = (Number(date.getMonth()) + 1).toLocaleString({
        minimumIntegerDigits: 2,
    });
    let year = Number(date.getFullYear());
    let folderDate = `${year}_${month}_${day}_${hh}_${mm}`;

    const course = {
        name: '',
        iri: '',
        slides: []
    }

    let files = await fs.readdir('_source')
    files.forEach(f => {
        if(fs.lstatSync(path.join('_source', f)).isDirectory() && fs.existsSync(path.join('_source', f, 'story.html'))){
            // parsing tincan.xml to get course data and to modify 
            const parser = new DOMParser()
            let dom = parser.parseFromString(fs.readFileSync(path.join('_source', f, 'tincan.xml'), 'utf-8'), 'text/xml')

            //getting course.id
            course.iri = dom.getElementsByTagName('activity')[0].getAttribute('id')
            /* dom.getElementsByTagName('activity')[0].setAttribute('id', course.iri) */

            //getting course.name
            course.name = dom.getElementsByTagName('description')[0].textContent
            dom.getElementsByTagName('name')[0].textContent = course.name

            //changing launch tag
            dom.getElementsByTagName('launch')[0].textContent = 'story.html'

            //changing slide activities IDs and setting course.slides
            Array.from(dom.getElementsByTagName('activity')).slice(1).forEach((a, index) => {
                course.slides.push({
                    index, 
                    iri: `${a.getAttribute('id')}`,
                    name: a.getElementsByTagName('name')[0].textContent
                })
            })

            fs.outputFileSync(
                path.join('_source', f, 'tincan.xml'),
                new XMLSerializer().serializeToString(dom),
                'utf-8'
            )

            //adding scripts to story.html
            let storyHTML = fs.readFileSync(path.join('_source', f, 'story.html'), 'utf-8')
            let html = HTMLParser.parse(storyHTML, {
                lowerCaseTagName: false,
                comment: false,
            });

            let title = html.querySelector('title');
            title.set_content(course.name);

            let head = html.querySelector('head');
            let headData = head.innerHTML;
            let headScripts = `
                <script>
                    const course = {
                        name: "${course.name}",
                        iri: "${course.iri}",
                        slides: [${course.slides.map(s => {
                            return `{index: ${s.index},
                                iri: "${s.iri}",
                                name: "${s.name}"}`
                        }).join(',')}]}
                </script>
                <script src="_sl_xapi/verbs.js" defer></script>
                <script src="_sl_xapi/moment.js" defer></script>
                <script src="_sl_xapi/sl_xapi.js" type="module" defer></script>
            `
            head.set_content(headData + headScripts);
            fs.outputFileSync(
                path.join('_source', f, 'story.html'),
                html.toString(),
                'utf-8'
            )

            //create structure.json
            let structure = `
            {
                "id": "${course.iri}",
                "type": "course",
                "component": "course",
                "name": "${course.name}",
                "version": 1,
                "items": [${course.slides.map((s, index) => {
                    return `
                    {
                        "id": "${s.iri}",
                        "parent": "${course.iri}",
                        "name": "${s.name}",
                        "type": "slide",
                        "type_name": "Слайд",
                        "weight": 1,
                        "is_leaf": true,
                        "order": ${index}
                    }
                    `
                }).join(',')}]
            }
            `

            fs.outputFileSync(
                path.join('_source', f, 'structure.json'),
                structure,
                'utf-8'
            )

            //deleting files
            fs.rmSync(path.join('_source', f, 'lms'), { recursive: true, force: true });
            fs.unlinkSync(path.join('_source', f, 'analytics-frame.html'))
            fs.unlinkSync(path.join('_source', f, 'index_lms.html'))
            fs.copySync('_sl_xapi', path.join('_source', f, '_sl_xapi'))

            //creating zip
            let zipName = f.includes(' - Storyline output') ? f.replace(' - Storyline output', '') : f
            let zip = new AdmZip();
            zip.addLocalFolder(path.join('_source', f));
            zip.writeZip(path.join('_source', 'zip', `${zipName}_${folderDate}.zip`));
            
        }
    })
}

init()