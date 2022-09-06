class Course {
    constructor(course) {
        this.name = course.name
        this.iri = course.iri
        this.slides = course.slides
        this.lastSlideVisited = 0
        this.timeStarted = new Date()
        this._slidesViewed = new Set()
        this.player = GetPlayer()
        this.duration = 0
    }

    init() {
        this.checkTestMode()

        XAPI.getData()
            .then((data) => (XAPI.data = data))
            .then(() => XAPI.sendStatement(new Statement('launched', this).statement))
            .then(() => XAPI.getState(this.iri))
            .then((data) => {
                if ('slidesViewed' in data) {
                    this._slidesViewed = new Set(data.slidesViewed)
                    this.duration = data.duration
                }
            })
            .then(() => {
                this.currentSlide = new Slide(this.slides[0])
                this.currentSlide.interacted()
            })
    }

    checkTestMode() {
        if (window.location.search === '') {
            console.log(
                '%cCourse launched in the test mode.',
                'font-weight:bold; color: red; font-size: 18px;'
            );
            this.testMode = true;
        } else {
            this.testMode = false;
        }
    }

    closeCourse () {
        console.log(
            '%cRETURNING',
            'color:lightblue; font-weight: bold; font-size: 18px;'
        );
        (function () {
            if (window.top) {
                return window.top;
            }
            return window.parent;
        })().location = '/back/';
        return false;
    }

    get state() {
        return {
            completed: this.completed,
            slidesViewed: Array.from(this._slidesViewed),
            duration: this.duration
        }
    }

    get SL_slidesViewed() {
        return Number(this.player.GetVar('slidesViewed')) 
    }

    get SL_totalSlides() {
        return Number(this.player.GetVar('totalSlides')) + 1 //somehow in SL this var is 1 less than actual amount
    }

    get SL_completed() {
        return this.player.GetVar('completed')
    }

    get completed() {
        return this.slidesViewed === this.slides.length
    }

    get slidesViewed() {
        return this._slidesViewed.size
    }

    set slidesViewed(v){
        this._slidesViewed.add(v)
        this.state.slidesViewed = Array.from(this._slidesViewed)
    }

    updateSlidesViewed() {
        let slideNumber = isNaN(this.player.GetVar('slideNumber')) ? 0 : this.player.GetVar('slideNumber')
        this.slidesViewed = slideNumber
        if(slideNumber !== 0) {

            this.proceedSlides(slideNumber)
        }
   }

    async proceedSlides(slideNumber){
        this.currentSlide.exited()
        .then(() => {
            this.lastSlideVisited = slideNumber
            this.currentSlide = new Slide(this.slides.filter(s => s.index === slideNumber)[0])
            this.currentSlide.interacted()
        })
    }

    setMenu(){
        Array.from(this._slidesViewed).forEach(slide => this.player.SetVar('slideVisited', slide))
    }

    exitCourse() {
        console.log(this.currentSlide)
        this.currentSlide.exited()
        .then(() => {
            this.duration = this.duration + (new Date() - this.timeStarted)
        })
        .then(() => XAPI.postState(this.iri, this.state))
        .then(() => {
            if (this.SL_completed || this.completed) {
                XAPI.sendStatement(
                    new Statement('completed', this).statement
                ).then(() => {
                    if (this.slidesViewed >= this.SL_totalSlides) {
                        return XAPI.sendStatement(
                            new Statement('passed', this).statement
                        )
                    } else {
                        return XAPI.sendStatement(
                            new Statement('failed', this).statement
                        )
                    }
                }).then(() => XAPI.sendStatement(
                    new Statement('exited', this).statement
                )).then(() => this.closeCourse())
            } else {
                XAPI.sendStatement(
                    new Statement('exited', this).statement
                ).then(() => this.closeCourse())
            }
        })
        
    }
}

class Slide {
    constructor(slide) {
        this.index = slide.index
        this.name = slide.name
        this.iri = slide.iri
        this.timeStarted = new Date()
        this.duration = 0
    }

    get state(){
        return {
            duration: this.duration,
        }
    }

    interacted() {
        XAPI.sendStatement(new Statement('interacted', this).statement)
        XAPI.getState(this.iri)
        .then(data => {
            if('duration' in data) {
                this.duration = data.duration
            }

            return Promise.resolve()
        })
    }

    exited() {
        this.duration = this.duration + (new Date() - this.timeStarted)
        XAPI.postState(this.iri, this.state)
        .then(() => XAPI.sendStatement(new Statement('exited', this).statement))
    }
}

class XAPI {
    constructor() {}

    static async getData() {
        if (!window.course.testMode) {
            if (
                window.location.search.includes('xAPILaunchService') &&
                window.location.search.includes('xAPILaunchKey')
            ) {
                console.log(
                    '%cxAPI Launch found',
                    'color:lightblue;font-size:16px;font-weight: bold;'
                );

                let queryParams = XAPI.parseQuery(window.location.search);
                const response = await fetch(
                    queryParams.xAPILaunchService +
                    'launch/' +
                    queryParams.xAPILaunchKey, {
                        method: 'POST',
                    }
                );

                return await response.json();
            } else {
                let queryParams = XAPI.parseQuery(window.location.search);
                let context = {};
                if (queryParams.context) {
                    context = JSON.parse(queryParams.context);
                }
                let data = {
                    endpoint: queryParams.endpoint,
                    auth: queryParams.auth,
                    actor: JSON.parse(queryParams.actor),
                    registration: queryParams.registration,
                    context: context,
                };

                if (Array.isArray(data.actor.account)) {
                    data.actor.account = data.actor.account[0];
                }

                if (Array.isArray(data.actor.name)) {
                    data.actor.name = data.actor.name[0];
                }

                if (
                    data.actor.account &&
                    data.actor.account.accountServiceHomePage
                ) {
                    data.actor.account.homePage =
                        data.actor.account.accountServiceHomePage;
                    data.actor.account.name = data.actor.account.accountName;
                    delete data.actor.account.accountServiceHomePage;
                    delete data.actor.account.accountName;
                }

                return new Promise((resolve, reject) => resolve(data));
            }
        } else {
            return new Promise((resolve, reject) =>
                resolve({
                    actor: 'Unknown',
                })
            );
        }
    }

    static parseQuery(queryString) {
        let query = {};
        let pairs = (
            queryString[0] === '?' ? queryString.substr(1) : queryString
        ).split('&');

        pairs.forEach((pair) => {
            let [key, value] = pair.split('=');
            query[decodeURIComponent(key)] = decodeURIComponent(value || '');
        });

        return query;
    }

    static async sendStatement(stmt) {
        console.log(`%c...sending statement: ${stmt.verb.display["en-US"]}`, 'color:gray;');
        console.log(stmt);
        if (!window.course.testMode) {
            const response = await fetch(XAPI.data.endpoint + 'statements', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Authorization': XAPI.data.auth,
                    'X-Experience-API-Version': '1.0.3',
                },
                body: JSON.stringify(stmt),
            });

            const result = await response.json();
            return Promise.resolve(result)
        }
    }

    static getURL(stateId) {
        let agentObj = {
            objectType: 'Agent',
            name: XAPI.data.actor.name,
            account: {
                name: XAPI.data.actor.account.name,
                homePage: XAPI.data.actor.account.homePage,
            },
        };

        let agent = encodeURIComponent(JSON.stringify(agentObj).slice(1, -1));

        let activityId = window.course.iri

        let str = `activityId=${activityId}&stateId=${stateId}&agent={${agent}}`;

        let url = `${XAPI.data.endpoint}activities/state?${str}`;

        return url;
    }

    static async getState(stateId) {
        console.log(`%c...getting state for: ${stateId}`, 'color:gray;');

        try {
            let url = XAPI.getURL(stateId);

            let res = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': XAPI.data.auth,
                    'X-Experience-API-Version': '1.0.3',
                    'Content-Type': 'application/json; charset=utf-8',
                },
            });

            let data = await res.json();
            console.log(data)
            return data;
        } catch {
            console.warn(`%cState for ${stateId} was not found!`, 'color:red;')
            return Promise.resolve({
                id: stateId,
                result: false
            })
        }
    }

    static async postState(stateId, stateObj) {
        if (!window.course.testMode) {
            let url = XAPI.getURL(stateId);
            let res = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: XAPI.data.auth,
                    'X-Experience-API-Version': '1.0.3',
                    'Content-Type': 'application/json; charset=utf-8',
                },
                body: JSON.stringify(stateObj),
            });
            console.log(`%cState posted: ${res.ok}`, 'color:gray;');
            return Promise.resolve(res.ok)
        }
    }

    static async deleteState(stateId) {
        if (!window.course.testMode) {
            let url = XAPI.getURL(stateId);
            let res = await fetch(url, {
                method: 'DELETE',
                headers: {
                    Authorization: XAPI.data.auth,
                    'X-Experience-API-Version': '1.0.3',
                    'Content-Type': 'application/json; charset=utf-8',
                },
            });
            console.log(`%c${stateId} state deleted: ${res.ok}`, 'color:gray;');
            return Promise.resolve(res.ok)
        }
    }
}

class Statement {
    constructor(verb, item) {
        this.item = item
        this.iri = item.iri
        this.name = item.name
        this.verbString = verb;
        this.time = new Date();
        this.duration = item.duration
    }

    get id() {
        return {
            id: window.crypto.randomUUID()
        };
    }

    get object() {
        let object = {
            object: {
                id: '',
                definition: {},
            },
        };


        object.object.id = this.iri;

        object.object.definition = {
            name: {
                'en-US': this.name,
                'ru-RU': this.name,
            },
            description: {
                'en-US': this.name,
                'ru-RU': this.name,
            },

        }

        return object;
    }

    get context() {
        let object = {
            context: {
                registration: XAPI.data.registration,
                contextActivities: {
                    grouping: XAPI.data ?.context?.contextActivities?.grouping || [],
                },
            },
        };

        return object;
    }

    get verb() {
        return {
            verb: verbs[this.verbString],
        };
    }

    get actor() {
        return {
            actor: XAPI.data.actor,
        };
    }

    get result() {
        let object = {
            result: {},
        };

        if (this.verbString === 'completed') {
            Object.assign(object.result, {
                completion: this.item.completed,
                duration: moment
                    .duration(
                        Math.round( this.duration / 1000),
                        'seconds'
                    )
                    .toISOString(),
            });
        }

        if (this.verbString === 'passed' || this.verbString === 'failed') {
            Object.assign(object.result, {
                success: this.verbString === 'passed' ? true : false,
                score: {
                    raw: this.item.slidesViewed,
                    scaled: (1 / this.item.slides.length) * this.item.slidesViewed,
                    min: 0,
                    max: this.item.slides.length,
                },
                duration: moment
                    .duration(
                        Math.round(this.duration / 1000),
                        'seconds'
                    )
                    .toISOString(),
            });
        }

        if (this.verbString === 'exited') {
            Object.assign(object.result, {
                duration: moment
                    .duration(
                        Math.round(this.duration / 1000),
                        'seconds'
                    )
                    .toISOString(),
            });
        }

        return object;
    }

    get timestamp() {
        return {
            timestamp: this.time
        };
    }

    get statement() {
        let finalStatement = Object.assign({},
            this.id,
            this.actor,
            this.verb,
            this.object,
            this.context,
            this.timestamp,
            this.result
        );

        if (
            this.verbString === 'interacted' ||
            this.verbString === 'launched'
        ) {
            delete finalStatement.result;
        }

        return finalStatement;
    }
}

window.addEventListener('load', async function () {
    window.XAPI = XAPI;
    window.course = new Course(course)
    window.course.init()
});