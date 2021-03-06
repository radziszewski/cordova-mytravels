﻿(function () {
    "use strict";

    var spa = { // Single-Page Application
            history: [] // historia przeglądanych stron - tablica url
        },
        app = {
            isOnline: false,
            pictureList: [],
            isMapScriptLoaded: false,
            options: {}
        },
        mainView = $('main');


    app.onDeviceReady = function () {
        document.addEventListener("backbutton", app.onBackKeyDown, false);
        document.addEventListener("offline", app.offline, false);
        document.addEventListener("online", app.online, false);

        app.openDatabase(function () {
            app.createFolders(function () {
                app.init();
            });
        });
    };

    app.init = function () {
        app.checkInternetStatus();
        app.prepareOptions();
        spa.init();
        spa.route('mainPage.html');
    };

    app.checkInternetStatus = function () {
        if (navigator.connection.type === Connection.NONE)
            app.isOnline = false;
        else
            app.isOnline = true;
    }

    app.offline = function () {
        app.isOnline = false;
    };

    app.online = function () {
        app.isOnline = true;
    };

    app.onBackKeyDown = function () {
        if (spa.history.length > 1) // jeśli w tablicy są podstrony
            spa.route('back');
        else
            navigator.app.exitApp(); // zamknięcie aplikacji
    };

    app.openDatabase = function (onSuccess) {
        app.db = window.sqlitePlugin.openDatabase({ name: 'mytravels.db', location: 'default' }, function (db) {
            db.transaction(function (tx) {
                //tx.executeSql('DROP TABLE IF EXISTS album');
                //tx.executeSql('DROP TABLE IF EXISTS picture');
                //tx.executeSql('DROP TABLE IF EXISTS tag');
                //tx.executeSql('DROP TABLE IF EXISTS tag_relationship');
                //tx.executeSql('DROP TABLE IF EXISTS option');
                tx.executeSql('CREATE TABLE IF NOT EXISTS album (id integer primary key autoincrement, name text, description text)');
                tx.executeSql('CREATE TABLE IF NOT EXISTS picture (id integer primary key autoincrement, album_id integer, path text, thumbnail_path text, date datetime default (datetime(\'now\', \'localtime\')), latitude Decimal(8,6), longitude Decimal(9,6), weather text, orientation integer default 0)');
                tx.executeSql('CREATE TABLE IF NOT EXISTS tag (id integer primary key autoincrement, name text)');
                tx.executeSql('CREATE TABLE IF NOT EXISTS tag_relationship (tag_id integer, picture_id integer)');
                tx.executeSql('CREATE TABLE IF NOT EXISTS option (id integer primary key autoincrement, key text, value text)');
                //tx.executeSql('ALTER TABLE picture ADD orientation integer default 0');

            }, function (error) {
                app.onError('Nie mażna utworzyć tabel');
            }, onSuccess);
        }, function (error) {
            app.onError('Nie można utworzyć bazy danych');
        });
    };

    app.createFolders = function (onSuccess) {
        var saveFolder = 'albums', // nazwa folderu gdzie będą zapisywane zdjęcia
            thumbnailsFolder = 'thumbnails', //nazwa folderu na miniaturki zdjęć
            rootPath = (cordova.platformId === 'windows') ? cordova.file.dataDirectory : cordova.file.externalDataDirectory;

        app.mainPath = rootPath + saveFolder;
        app.thumbnailsPath = rootPath + thumbnailsFolder;

        createFolder(saveFolder, function () {
            createFolder(thumbnailsFolder, onSuccess);
        });

        function createFolder(folderName, createSuccess) {
            window.resolveLocalFileSystemURL(rootPath, function (fileSys) {
                fileSys.getDirectory(folderName, { create: true, exclusive: false }, function (directory) { //wybiera folder o nazwie folderName, jeśli nie znajdzie to go utworzy
                    createSuccess();
                }, onError.bind(null, saveFolder));
            }, onError.bind(null, saveFolder));
        }

        function onError(folderName) {
            app.onError('Błąd utworzenia folderu: ' + folderName);
        }
    };

    app.mainPage = function (params) {
        $('title').innerText = 'My Photo Albums';

        app.db.executeSql("SELECT * FROM album ORDER BY id DESC", [], function (res) {
            var output = '';
            for (var i = 0; i < res.rows.length; i++) {
                output += '<a href="album.html?id=' + res.rows.item(i).id +
                    '" class="button-list">' + res.rows.item(i).name + '</a>';
            }

            if (res.rows.length)
                $('albumList').innerHTML = output;
            else
                $('albumList').innerHTML = '<div class="list-info">Brak</div>';
        });
    };

    app.newAlbum = function (params) {
        $('title').innerText = 'Dodaj nowy album';

        var form = $('addAlbum'); // formularz
        form.addEventListener("submit", addAlbum, false);

        function addAlbum(e) {
            e.preventDefault();
            var name = $('name').value.trim().replace(/\W/g, ' ').replace(/\s+/g, ' ').substring(0, 100); //białe znaki, tylko alfanumeryczne i zamienia wiele spacji na jedną, max 100 znakow
            var description = $('description').value;

            if (name !== "") {
                app.db.executeSql("INSERT INTO album (name, description) VALUES (?,?)", [name, description], function (res) {
                    navigator.notification.alert('Dodano!', function () {
                        spa.route('back');
                    });
                }, function (error) {
                    app.onError('Błąd. Nie zapisano');
                });
            } else {
                app.onError('Podaj nazwę albumu');
            }
        }
    };

    app.album = function (params) {
        var album,
            newPicture = {
                latitude: '',
                longitude: '',
                weather: '',
                orientation: 0
            },
            exifData = {},
            CAMERA = Camera.PictureSourceType.CAMERA,
            PHOTOLIBRARY = Camera.PictureSourceType.PHOTOLIBRARY,
            endGetPosition = false;

        app.showLoader();
        setTimeout(app.hideLoader, 400);

        app.db.executeSql("SELECT * FROM album WHERE id = ?", [params.id], function (res) {
            if (res.rows.length)
                albumPageInit(res.rows.item(0));
            else
                app.onError('Nie znaleziono albumu');
        });

        function albumPageInit(row) {
            album = row;

            $('title').innerText = album.name;
            $('albumDesc').innerHTML = album.description;
            $('iconNav').innerHTML = '<a href="albumSettings.html?id=' + album.id + '"><i class="icon-cog"></i></a>';

            $('takePhoto').addEventListener('click', function () {
                newPicture.source = CAMERA;
                getCamera(CAMERA);
            }, false);

            $('getPhoto').addEventListener('click', function () {
                newPicture.source = PHOTOLIBRARY;
                getCamera(PHOTOLIBRARY);
            }, false);

            $('map').setAttribute('href', 'albumMap.html?id=' + album.id);

            getPictures();

        }

        function getPictures() {
            app.db.executeSql("SELECT * FROM picture WHERE album_id = ? ORDER BY id DESC", [album.id], function (res) {
                app.pictureList = [];
                var output = '';
                for (var i = 0; i < res.rows.length; i++) {
                    var degree = app.getOrientationDegree(res.rows.item(i).orientation);
                    var rotate = degree !== 0 ? 'style="transform: rotate(' + degree + 'deg)"' : '';
                    output += '<a href="photo.html?id=' + res.rows.item(i).id +
                        '"><img src="' + res.rows.item(i).thumbnail_path + '" ' + rotate + ' /></a>';
                    app.pictureList.push(res.rows.item(i));
                }

                if (res.rows.length)
                    $('photoList').innerHTML = output;
                else
                    $('photoList').innerHTML = '<div class="list-info">Brak</div>';

                $('photoCount').innerText = res.rows.length;
            });
        }

        function getCamera(source) {
            app.showLoader();

            navigator.camera.getPicture(function (photoUri) {
                CordovaExif.readData(photoUri, function (exifObject) {
                    exifData = exifObject;
                    window.resolveLocalFileSystemURL(photoUri, savePicture, onError);
                });
            }, closeCamera, {
                sourceType: source,
                quality: 100,
                //correctOrientation: true,
                destinationType: navigator.camera.DestinationType.FILE_URI
            });
        }

        function closeCamera() {
            spa.refreshPage();
            app.hideLoader();
        }

        function onError(error) {
            app.onError('Błąd zapisu zdjęcia');
        }

        function savePicture(entry) {
            getLocalization();

            var d = new Date(),
                fileName = d.getTime() + ".jpeg";

            window.resolveLocalFileSystemURL(app.mainPath, function (fileSys) {
                newPicture.path = fileSys.toURL() + album.name + "/" + fileName;
                fileSys.getDirectory(album.name, { create: true, exclusive: false }, function (directory) {
                    if (newPicture.source === CAMERA)
                        entry.moveTo(directory, fileName, createThumbnails, onError);
                    else
                        entry.copyTo(directory, fileName, createThumbnails, onError);
                }, onError);
            }, onError);
        }

        function createThumbnails() {
            var image = new Image(),
                canvas = document.createElement("canvas");

            smallThumbnail(image, canvas, function () {
                largeThumbnail(image, canvas, function () {
                    getDateTime();
                });
            });
        }

        function smallThumbnail(image, canvas, callback) {
            var ctx = canvas.getContext('2d');

            canvas.width = 150;
            canvas.height = 150;

            image.onload = function () {
                var startCrop, endCrop, cropWidth, cropHeight;

                if (image.width > image.height) {
                    startCrop = (image.width - image.height) / 2;
                    endCrop = 0;
                    cropWidth = image.height;
                    cropHeight = cropWidth;
                } else {
                    startCrop = 0;
                    endCrop = (image.height - image.width) / 2;
                    cropWidth = image.width;
                    cropHeight = cropWidth;
                }

                ctx.drawImage(image,
                    startCrop, endCrop,
                    cropWidth, cropHeight,
                    0, 0,
                    150, 150);

                if (canvas.toBlob) {
                    canvas.toBlob(function (blob) {
                        var d = new Date(),
                            fileName = d.getTime() + ".jpeg";
                        newPicture.thumbnailPath = app.thumbnailsPath + "/" + fileName;
                        saveThumbnail(blob, fileName, callback);
                    }, 'image/jpeg');
                } else { onError(); }
            };
            image.src = newPicture.path;
        }

        function largeThumbnail(image, canvas, callback) {
            var ctx = canvas.getContext('2d');

            image.onload = function () {
                var ratio = image.width / image.height;

                canvas.width = 500;
                canvas.height = parseInt(500 / ratio);

                ctx.drawImage(image,
                    0, 0,
                    image.width, image.height,
                    0, 0,
                    canvas.width, canvas.height);

                if (canvas.toBlob) {
                    canvas.toBlob(function (blob) {
                        canvas = null;
                        image = null;
                        var fileName = newPicture.thumbnailPath.split('/').pop().split('.')[0] + "_1.jpeg";
                        saveThumbnail(blob, fileName, callback);
                    }, 'image/jpeg');
                } else { onError(); }
            };
            image.src = newPicture.path;
        }

        function saveThumbnail(blob, fileName, callback) {
            window.resolveLocalFileSystemURL(app.thumbnailsPath, function (fileSys) {
                fileSys.getFile(fileName, { create: true, exclusive: false }, function (fileEntry) {
                    fileEntry.createWriter(function (fileWriter) {
                        fileWriter.onwrite = callback;
                        fileWriter.onerror = onError;
                        fileWriter.write(blob);
                    });
                }, onError);
            }, onError);
        }

        function getLocalization() {
            endGetPosition = false;
            if (app.options.saveGPS) {
                if (newPicture.source === CAMERA)
                    getCurrentLocation(); //pobranie wspolrzednych i zapisanie pogody
                else {
                    if (exifData.GPSLatitude && exifData.GPSLatitude) {
                        newPicture.latitude = exifData.GPSLatitude[0] + exifData.GPSLatitude[1] / 60 + exifData.GPSLatitude[2] / 3600;
                        newPicture.longitude = exifData.GPSLongitude[0] + exifData.GPSLongitude[1] / 60 + exifData.GPSLongitude[2] / 3600;
                    }
                    endGetPosition = true;
                }
            }
            else {
                endGetPosition = true;
            }
        }

        function getCurrentLocation() {

            function onSuccess(position) {
                newPicture.latitude = position.coords.latitude;
                newPicture.longitude = position.coords.longitude;
                getWeatherInfo();
            }

            function onError() {
                app.onError('Nie można określić lokalizacji');
                endGetPosition = true;
            }

            navigator.geolocation.getCurrentPosition(onSuccess, onError, { enableHighAccuracy: true, timeout: 10000 });
        }

        function getWeatherInfo() {
            if (app.options.saveWeather)
                app.getWeather(newPicture.latitude, newPicture.longitude, onSuccess, onError);
            else
                endGetPosition = true;
            
            function onSuccess(results) {
                if (results.weather.length) {
                    var weather = {
                        temp: results.main.temp,
                        desc: results.weather[0].description,
                        icon: results.weather[0].icon
                    };

                    newPicture.weather = JSON.stringify(weather);
                    endGetPosition = true;
                }
            }

            function onError(message) {
                app.onError(message);
                endGetPosition = true;
            }
        }

        function getDateTime() {
            if (newPicture.source === CAMERA)
                newPicture.datetime = new Date();
            else {
                var datetime = exifData.DateTimeOriginal ? exifData.DateTimeOriginal : exifData.DateTime;
                newPicture.datetime = datetime.split(' ')[0].replace(/:/g, '-') + ' ' + datetime.split(' ')[1];
            }
               
            getOrientation();
        }

        function getOrientation() {
            if (newPicture.source === PHOTOLIBRARY) {
                var orientation = exifData.Orientation ? exifData.Orientation : 0;
                console.log(orientation);
                newPicture.orientation = parseInt(orientation);
            }

            waitForPosition();
        }

        function waitForPosition() {
            if (endGetPosition)
                addPicture();
            else
                setTimeout(waitForPosition, 1000);
        }

        function addPicture() {
            app.db.executeSql('INSERT INTO picture (album_id, path, thumbnail_path, date, latitude, longitude, weather, orientation) VALUES (?,?,?,?,?,?,?,?)', [album.id, newPicture.path, newPicture.thumbnailPath, newPicture.datetime, newPicture.latitude, newPicture.longitude, newPicture.weather, newPicture.orientation], function (rs) {
                if (app.options.saveTags)
                    getTags(rs.insertId);
                else
                    onFinish();
            }, onError);
        }

        function getTags(pictureID) {

            app.addTags = function () {
                $('title').innerHTML = 'Dodaj tagi do zdjęcia';
                app.showAllTags();
                app.hideLoader();
                var form = $('addTags'); // formularz
                form.addEventListener("submit", function (e) {
                    e.preventDefault();
                    spa.clearLastURL();
                    app.showLoader();
                    var tags = $('tags').value.split(',');
                    app.addTagsToPicture(pictureID, tags, onFinish);
                }, false);


            };
            spa.route('addTags.html');
        }

        function onFinish() {
            if (app.options.cameraLoop)
                getCamera(newPicture.source);
            else
                closeCamera();
        }
    };

    app.albumSettings = function (params) {
        var album;

        app.db.executeSql("SELECT * FROM album WHERE id = ?", [params.id], function (res) {
            if (res.rows.length)
                pageInit(res.rows.item(0));
            else
                app.onError('Nie znaleziono albumu');
        });

        function pageInit(row) {
            album = row;

            $('title').innerText = album.name;
            $('albumEdit').setAttribute('href', 'albumEdit.html?id=' + album.id);
            $('albumDelete').addEventListener('click', function () {
                removeAlbum();
            }, false);

        }

        function removeAlbum() {
            navigator.notification.confirm('Czy chcesz usunąc ten album?', function (index) {
                if (index === 1) {
                    app.db.executeSql('DELETE FROM album WHERE id = ?', [album.id], function (res) {
                        navigator.notification.confirm('Czy chcesz usunąc wszystkie zdjęcia, które znajdowały się w tym albumie?', removeAllPicture)
                    });
                }
            })
        }

        function removeAllPicture(index) {
            if (index === 1) {
                app.db.executeSql('DELETE FROM picture WHERE album_id = ?', [album.id], function (res) {
                    navigator.notification.alert('Usunięto album i zdjęcia', function () {
                        spa.loadStartPage();
                    })
                });
            }
            else {
                navigator.notification.alert('Usunięto album bez zdjęć', function () {
                    spa.loadStartPage();
                })
            }
        }

    };

    app.albumEdit = function (params) {
        var album;

        app.db.executeSql("SELECT * FROM album WHERE id = ?", [params.id], function (res) {
            if (res.rows.length)
                pageInit(res.rows.item(0));
            else
                app.onError('Nie znaleziono albumu');
        });

        function pageInit(row) {
            album = row;

            $('title').innerText = album.name;
            $('name').value = album.name;
            $('description').value = album.description;

            var form = $('editAlbum'); // formularz
            form.addEventListener("submit", editAlbum, false);
        }

        function editAlbum(e) {
            e.preventDefault();
            var description = $('description').value;

            app.db.executeSql("UPDATE album SET description = ? WHERE id = ? ", [description, album.id], function (res) {
                navigator.notification.alert('Zapisano!', function () {
                    spa.route('back');
                });
            }, function (error) {
                app.onError('Błąd. Nie zapisano');
            });

        }
    };

    app.editTags = function (params) {
        var pictureID = params.pictureID,
            tagInput = $('tags'),
            form = $('editTags'),
            tags = [];

        $('title').innerHTML = 'Edytuj tagi';

        app.getTagsByPictureID(pictureID, showTags);

        function showTags(tags) {
            var output = '';
            for (var i = 0; i < tags.length; i++) {
                if (i === 0) output += tags[i].name;
                else output += ',' + tags[i].name;
            }
            tagInput.value = output;
        }

        app.showAllTags();

        form.addEventListener("submit", function (e) {
            e.preventDefault();
            tags = tagInput.value.split(',');
            editTags();
        }, false);

        function editTags() {
            app.db.executeSql('DELETE FROM tag_relationship WHERE picture_id = ?', [pictureID], function (res) {
                app.addTagsToPicture(pictureID, tags, onSuccess);
            });
        }

        function onSuccess() {
            navigator.notification.alert('Zapisano!', function () {
                spa.route('back');
            });
        }

    };

    app.showAllTags = function () {
        app.db.executeSql("SELECT * FROM tag", [], function (res) {
            var output = '',
                tagInput = $('tags');
            for (var i = 0; i < res.rows.length; i++) {
                var tag = document.createElement('div');
                tag.id = res.rows.item(i).name;
                tag.className = 'tag';
                tag.innerHTML = '#' + res.rows.item(i).name;
                tag.addEventListener("click", function () {
                    if (tagInput.value != '')
                        tagInput.value = tagInput.value + ', ' + this.getAttribute('id');
                    else
                        tagInput.value = this.getAttribute('id');
                    tagInput.value = tagInput.value.replace(/,,/, ',');

                }, false);
                $('allTags').appendChild(tag);
            }

            if (!res.rows.length)
                $('allTags').innerHTML = '<div class="list-info">Brak</div>';

        });


    };

    app.addTagsToPicture = function (pictureID, tags, callbackSuccess) {
        var counter = 0;
        addTag();

        function addTag() {
            counter++;
            if (counter <= tags.length) {
                var tag = tags[counter - 1];
                tag = tag.trim();
                if (tag != '')
                    addNextTag(tag);
                else
                    addTag();
            }
            else {
                callbackSuccess();
            }
        }

        function onError() {
            console.log('bład dodania tagu');
        }

        function addNextTag(tagName) {
            app.db.executeSql("SELECT id FROM tag WHERE name = ?", [tagName], function (res) {
                if (res.rows.length > 0) {
                    console.log('znaleziono ' + res.rows.item(0).id);
                    addTagToPicture(res.rows.item(0).id);
                }
                else {
                    app.db.executeSql('INSERT INTO tag (name) VALUES (?)', [tagName], function (rs) {
                        console.log('dodało nowy tag ' + rs.insertId);
                        addTagToPicture(rs.insertId);
                    }, onError);
                }

            }, onError);
        }

        function addTagToPicture(tagID) {
            app.db.executeSql("SELECT * FROM tag_relationship WHERE picture_id = ? AND tag_id = ?", [pictureID, tagID], function (res) {
                if (!res.rows.length) { // length 0
                    console.log('dodanie tagu do zdj');
                    app.db.executeSql('INSERT INTO tag_relationship (picture_id, tag_id) VALUES (?,?)', [pictureID, tagID], function (rs) {
                        addTag();
                    }, onError);
                }
                else {
                    console.log('znaleziono juz tag z tym zdjeciem');
                    addTag();
                }

            }, onError);
        }

    };

    app.getTagsByPictureID = function (pictureID, callback) {
        app.db.executeSql("SELECT * FROM tag as t INNER JOIN tag_relationship as tr ON t.id = tr.tag_id WHERE tr.picture_id = ?", [pictureID], function (res) {
            var tags = [];
            for (var i = 0; i < res.rows.length; i++) {
                tags.push({
                    id: res.rows.item(i).id,
                    name: res.rows.item(i).name
                });
            }
            callback(tags);
        });
    };

    app.getWeather = function (latitude, longitude, successCallback, errorCallback) {

        if (app.isOnline) {
            var url = "http://api.openweathermap.org/data/2.5/weather?lat=" + latitude + "&units=metric&lon=" + longitude + "&units=metric&lang=pl&appid=1671d684d673b7279571dfba6d8127e9";

            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.responseType = 'json';
            xhr.onload = function () {
                var status = xhr.status;
                if (status === 200) {
                    successCallback(xhr.response);
                } else {
                    errorCallback("Nie zapisano pogody");
                }
            };
            xhr.send();
        }
        else {
            errorCallback('Nie zapisano pogody. Brak połączenia z internetem');
        }


    };

    app.photo = function (params) {
        var picture = {},
            previousPicture = 0,
            nextPicture = 0;

        app.showLoader();
        setTimeout(app.hideLoader, 400);

        var pictureNumber = 1;
        for (var i = 0; i < app.pictureList.length; i++) {
            if (app.pictureList[i].id == params.id) {
                pictureNumber = i + 1;
                picture = app.pictureList[i];
                if (i > 0 && i < app.pictureList.length - 1) {
                    previousPicture = i - 1;
                    nextPicture = i + 1;
                } 
                else if (i === 0 ) {
                    if(app.pictureList.length > 1) {
                        previousPicture = app.pictureList.length - 1;
                        nextPicture = i + 1;
                    }
                    else {
                        previousPicture = 0;
                        nextPicture = 0;
                    }
                }
                else if (i === app.pictureList.length - 1) {
                    previousPicture = i-1;
                    nextPicture = 0;
                }
                
                init();
            }
        }

        function init() {
            $('title').innerHTML = 'Zdjęcie ' + pictureNumber + '/' + app.pictureList.length;
            initControl();

            setTimeout(function () {
                $('photo').src = picture.thumbnail_path.slice(0, -5) + '_1.jpeg';
                //$('photo').onload = app.hideLoader;
            }, 10);
            $('photo').onload = setOrientation;

            try {
                var weather = JSON.parse(picture.weather);
                $('weatherIcon').src = 'images/weather_icon/' + weather.icon + '.png';            
                $('weatherDesc').innerText = weather.desc;
                $('weatherTemp').innerText = Number(weather.temp).toFixed(0);
            }
            catch (e) {
                $('weatherInfo').style.display = 'none';
            }

            var mapLink = $('showOnMap');
            var photoLoc = $('photoLoc');

            if (picture.latitude && picture.longitude) {
                mapLink.setAttribute('href', 'map.html?lat=' + picture.latitude + '&lng=' + picture.longitude + '&img=' + picture.thumbnail_path);
                photoLoc.innerText = '' + Number(picture.latitude).toFixed(2) + ' ' + Number(picture.longitude).toFixed(2);
            }
            else {
                mapLink.style.display = 'none';
                photoLoc.innerText = 'Nie zapisano';
            }

            $('delete').addEventListener("click", removePicture, false);

            $('photoDate').innerText = showDate(picture.date);

            $('editTags').setAttribute('href', 'editTags.html?pictureID=' + picture.id);

            app.getTagsByPictureID(picture.id, showTagsToPicture);
        }

        function setOrientation() {
            if (picture.orientation === 6 || picture.orientation === 8) {
                var w = $("photoWrap").clientWidth; //szerokość ekranu
                $("photo").style.height = w + 'px'; //wysokość zdjęcia równa szerokości ekranu bo po rotacji wysokość zdjęcia będzie jego szerokością
                $("photo").style.width = 'auto'; //zachowanie proporcji zdjęcia bo domyślnie width="100%"

                var h = $("photo").clientWidth; //szerokość zdjęcia przed rotacją
                $("photoWrap").style.height = h + 'px'; //po rotacji szerokość będzie stanowić wysokość zdjęcia

                $("photo").style['transform-origin'] = '0% 0%';
                var translate = '0%, -100%'; //x%, y%
               
                var degree = app.getOrientationDegree(picture.orientation);
                if (degree < 0)
                    translate = '-100%, 0%';

                $("photo").style.transform = 'rotate(' + degree + 'deg) translate(' + translate + ')';

            }
        }

        function initControl() {
            $('prev').addEventListener('click', function () {
                getNextPicture('left');
            }, false);
            $('next').addEventListener('click', function () {
                getNextPicture('right');
            }, false);
            $('photo').addEventListener('click', function () {
                viewPicture();
            }, false);
        }

        function getNextPicture(dir) {
            app.showLoader();
            spa.history.pop();
            if (dir === 'left') {
                spa.route('photo.html?id=' + app.pictureList[previousPicture].id);
            } else {
                spa.route('photo.html?id=' + app.pictureList[nextPicture].id);
            }
        }

        function viewPicture() {
            var pinchZoom;
            $('popoverContent').innerHTML = '' +
                '<canvas id="photoView" style="width: 100%; height: 100%"></canvas>';

            $('popover').style.display = 'block';
            pinchZoom = new PinchZoomCanvas({
                canvas: $('photoView'),
                path: picture.path,
                doubletap: false
            });

            $('closePopover').addEventListener('click', function close() {
                pinchZoom.destroy();
                $('popover').style.display = 'none';
                this.removeEventListener('click', close);
            }, false);
        }

        function showDate(photoDate) {
            function leadingZero(i) {
                return (i < 10) ? '0' + i : i;
            }
            var date = new Date(photoDate);
            var textDate = date.getDate() + "." + leadingZero((date.getMonth() + 1)) + "." + date.getFullYear() + 
                   ' ' + date.getHours() + ":" + leadingZero(date.getMinutes()) + ":" + leadingZero(date.getSeconds());

            return textDate;
        }

        function showTagsToPicture(tags) {
            var output = '';
            for (var i = 0; i < tags.length; i++) {
                output += '<a href="tag.html?id=' + tags[i].id +
                    '">#' + tags[i].name + '</a>';
            }

            if (tags.length)
                $('photoTags').innerHTML = output;
            else
                $('photoTags').innerHTML = '<div class="list-info">Brak</div>';
        }

        function removePicture() {
            navigator.notification.confirm('Czy chcesz usunąc to zdjęcie?', onRemove)

            function onRemove(index) {
                if (index === 1) {
                    app.db.transaction(function (tx) {
                        tx.executeSql('DELETE FROM tag_relationship WHERE picture_id = ?', [picture.id]);
                        tx.executeSql('DELETE FROM picture WHERE id = ?', [picture.id]);
                    }, function (error) {
                        app.onError('Nie mażna usunąć zdjęcia');
                    }, function () {
                        navigator.notification.alert('Usunięto!', function () {
                            spa.route('back');
                        });
                    });
                }
            }  
        }
    };

    app.tag = function (params) {
        var tag;

        app.db.executeSql("SELECT * FROM tag WHERE id = ?", [params.id], function (res) {
            if (res.rows.length)
                tagPageInit(res.rows.item(0));
            else
                app.onError('Nie znaleziono tagu');
        });

        function tagPageInit(row) {
            tag = row;
            $('title').innerHTML = 'Tag: ' + tag.name;

            app.db.executeSql("SELECT p.* FROM picture as p INNER JOIN tag_relationship as tr ON p.id = tr.picture_id WHERE tr.tag_id = ? ORDER BY p.id DESC", [tag.id], function (res) {
                var output = '';
                app.pictureList = [];
                for (var i = 0; i < res.rows.length; i++) {
                    output += '<a href="photo.html?id=' + res.rows.item(i).id +
                        '"><img src="' + res.rows.item(i).thumbnail_path + '" /></a>';
                    app.pictureList.push(res.rows.item(i));
                }

                if (res.rows.length)
                    $('photoList').innerHTML = output;
                else
                    $('photoList').innerHTML = '<div class="list-info">Brak</div>';

                $('photoCount').innerText = res.rows.length;
            });

        }


    };

    app.search = function () {
        $('title').innerHTML = 'Szukaj zdjęć';
        app.db.executeSql("SELECT * FROM tag", [], function (res) {
            var output = '';
            for (var i = 0; i < res.rows.length; i++) {
                output += '<a href="tag.html?id=' + res.rows.item(i).id +
                    '">#' + res.rows.item(i).name + '</a>';
            }

            if (res.rows.length)
                $('photoTags').innerHTML = output;
            else
                $('photoTags').innerHTML = '<div class="list-info">Brak</div>';

        });
    };

    app.albumMap = function (params) {
        var pictures = [];
        $('title').innerHTML = 'Zdjęcia na mapie';

        app.loadMapScript(function () {
            app.db.executeSql("SELECT * FROM picture WHERE album_id = ? AND latitude != '' ORDER BY id DESC", [params.id], function (res) {
                for (var i = 0; i < res.rows.length; i++) {
                    if (res.rows.item(i).latitude && res.rows.item(i).longitude)
                        pictures.push(res.rows.item(i));
                }
                showOnMap();
            });
        }, app.onError);

        function showOnMap() {
            var markers = [];
            var mapOptions = {
                center: new google.maps.LatLng(0, 0),
                zoom: 1,
                mapTypeId: google.maps.MapTypeId.ROADMAP
            };

            var map = new google.maps.Map($("map_canvas"), mapOptions);

            var icon = {
                url: "",
                scaledSize: new google.maps.Size(75, 75),
                origin: new google.maps.Point(0, 0),
                anchor: new google.maps.Point(0, 0)
            };

            for (var i = 0; i < pictures.length; i++) {
               
                var latLong = new google.maps.LatLng(pictures[i].latitude, pictures[i].longitude);
                icon.url = pictures[i].thumbnail_path;
                var marker = new google.maps.Marker({
                    position: latLong,
                    icon: icon
                });
                markers.push(marker);

                setMarkerListener(marker, i);  
                
            }

            map.setCenter(markers[0].getPosition());
           
            var markerCluster = new MarkerClusterer(map, markers, { imagePath: 'images/m', maxZoom: 17 });

            map.setZoom(15);
        }

        function setMarkerListener(marker, i) {
            var pinchZoom;
            google.maps.event.addListener(marker, 'click', function () {

                $('popover').style.display = 'block';

                $('popoverContent').innerHTML = '' +
                    '<canvas id="photoView" style="width: 100%; height: 100%"></canvas>';

                pinchZoom = new PinchZoomCanvas({
                    canvas: $('photoView'),
                    path: pictures[i].path,
                    momentum: false,
                    doubletap: false
                });

                $('closePopover').addEventListener('click', function close() {
                    pinchZoom.destroy();
                    $('popover').style.display = 'none';
                    this.removeEventListener('click', close);
                }, false);
            });
        }

    };

    app.map = function (params) {
        $('title').innerHTML = 'Lokalizacja zdjęcia';

        app.loadMapScript(function () {
            var latitude = params.lat;
            var longitude = params.lng;

            var mapOptions = {
                center: new google.maps.LatLng(latitude, longitude),
                zoom: 1,
                mapTypeId: google.maps.MapTypeId.ROADMAP
            };
            var map = new google.maps.Map(document.getElementById("map_canvas"), mapOptions);

            var latLong = new google.maps.LatLng(latitude, longitude);
            var marker = new google.maps.Marker({
                position: latLong
            });

            var infowindow = new google.maps.InfoWindow({
                content: "<div><img width='100' src='" + params.img + "'/></div>"
            });
            setTimeout(function () { infowindow.open(map, marker); }, 500);

            marker.setMap(map);
            map.setZoom(14);
            map.setCenter(marker.getPosition());
        }, app.onError);   
    };

    app.loadMapScript = function (successCallback, errorCallback) {
        if (!app.isMapScriptLoaded) {
            if (app.isOnline) {
                var script = document.createElement("script");
                script.type = "text/javascript";

                script.onload = function () {
                    app.isMapScriptLoaded = true;
                    successCallback();
                };
                script.onerror = function () {
                    errorCallback('Nie można załadować skryptu');
                };
                script.src = 'https://maps.googleapis.com/maps/api/js?key=AIzaSyCH3VCLkbc0Bcjmsw2bWxF3hjvHdDrg-Fg';
                document.head.appendChild(script);
            }
            else {
                errorCallback('Brak połączenia z internetem');
            }
        }
        else {
            successCallback();
        }
    };

    app.settings = function (params) {
        $('title').innerHTML = 'Ustawienia';

        app.getOptions(function () {
            //switches
            $('saveGPS').checked = app.options.saveGPS;
            $('saveWeather').checked = app.options.saveWeather;
            $('saveTags').checked = app.options.saveTags;
            $('cameraLoop').checked = app.options.cameraLoop;

            initControl();
        });

        function initControl() {
            //switches
            var keys = ['saveGPS', 'saveWeather', 'saveTags', 'cameraLoop'];
            for (var i = 0; i < keys.length; i++) {
                $(keys[i]).addEventListener('change', function () {
                    if (this.checked) {
                        app.setOption(this.id, 1);
                    } else {
                        app.setOption(this.id, 0);
                    }
                });
            }
        }
    }

    app.setOption = function (key, value) {
        app.db.executeSql("UPDATE option SET value = ? WHERE key = ? ", [value, key], function () {
            app.getOptions();
        });
    }

    app.getOptions = function (callback) {
        app.db.executeSql("SELECT * FROM option ", [], function (res) {
            for (var i = 0; i < res.rows.length; i++) {
                if (res.rows.item(i).value === '1' || res.rows.item(i).value === '0')
                    app.options[res.rows.item(i).key] = res.rows.item(i).value === '1' ? true : false;
                else
                    app.options[res.rows.item(i).key] = res.rows.item(i).value;
            }
            if (!!callback) callback();
        });
    }

    app.prepareOptions = function () {
        var defaultOptions = {
                saveGPS: 1,
                saveWeather: 1,
                saveTags: 1,
                cameraLoop: 1
            }
        app.getOptions(function () {
            var keys = Object.keys(defaultOptions);
            for (var i = 0; i < keys.length; i++) {
                if (!(keys[i] in app.options)) {
                    app.db.executeSql('INSERT INTO option (key, value) VALUES (?,?)', [keys[i], defaultOptions[keys[i]]]);
                }
            }
        });
    }

    app.onError = function (message) {
        console.log(message);
        navigator.notification.alert(message, function () {});
    };

    app.showLoader = function () {
        $('wait').style.display = 'flex';
    };

    app.hideLoader = function () {
        $('wait').style.display = 'none';
    };

    app.changeAppIcon = function (page) {
        var fun = page.split('.')[0]; // zwraca nazwę strony bez rozszerzenia
        if (fun === 'mainPage')
            app.startPage();
        else
            app.subPage();
    };

    app.subPage = function () { // wczytano podstronę
        $('backNav').innerHTML = '<a href="back"><i class="icon-left"></i></a>';
    };

    app.startPage = function () { // wczytano stronę główną
        $('backNav').innerHTML = '<i class="icon-picture-1"></i>';
    };

    app.clearTopBarIcons = function () {
        $('iconNav').innerHTML = '';
    };

    app.getOrientationDegree = function (orientation) {
        var degree = 0;
        switch (orientation) {
            case 6: degree = 90; break;
            case 8: degree = -90; break;
        }
        return degree;
    };

    //
    // SPA
    //
    spa.init = function () { // przechwycenie zdarzenia kliknięcia w link
        document.body.onclick = function (e) { // click event dla każego elementu strony
            e = e || window.event;
            var link = findLink(e.target || e.srcElement);
            if (link && link.getAttribute('href').indexOf('#') == -1) { // jeśli element jest linkiem i nie jest kotwicą (#)
                spa.route(link.getAttribute('href'));
                return false;
            }
        };
        function findLink(el) { // el - najniższy element
            if (el.tagName === 'A') // czy element jest linkiem - zwraca link
                return el;
            while (el = el.parentNode) // dopóki element ma rodzica
                if (el.tagName === 'A')
                    return el;
            return null;
        }
    };

    spa.route = function (url) { // przekierowanie do podstrony
        url = spa.saveURL(url);
        url = spa.getParameters(url);
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url.page, true);
        xhr.onload = function (e) {
            var response = e.currentTarget;
            if (response.status == 200) { // strona została poprawnie wczytana
                mainView.innerHTML = response.responseText;
                spa.loadHook(url);
                var fun = url.page.split('.')[0]; // zwraca nazwę strony bez rozszerzenia
                if (app[fun])
                    app[fun](url.params); // wywołanie funkcji dla danej strony np.: app.nazwastrony() dla nazwastrony.html
            } else // błąd
                spa.history.pop();
        };
        xhr.onerror = function (e) {
            spa.history.pop();
        };
        xhr.send();
    };

    spa.getParameters = function (url) { // zwraca obiekt z nazwą strony i parametrami
        var page = url,
            params = {};

        if (url.indexOf('?') > 0) {
            page = url.split('?')[0];
            var query = url.split('?')[1].split('&');
            for (var i = 0; i < query.length; i++) {
                var param = query[i].split('=');
                params[param[0]] = param[1];
            }
        }
        return {
            page: page,
            params: params
        };
    };

    spa.saveURL = function (url) { // zapis url strony w tablicy spa.history
        if (url === 'back') {
            spa.history.pop();
            url = spa.history[spa.history.length - 1];
        } else
            spa.history.push(url);
        return url;
    };

    spa.refreshPage = function () {
        var url = spa.history[spa.history.length - 1];
        spa.history.pop();
        spa.route(url);
    };

    spa.clearLastURL = function () {
        spa.history.pop();
    };

    spa.loadStartPage = function () {
        spa.history = [];
        spa.route('mainPage.html');
    };

    spa.loadHook = function (url) {
        app.changeAppIcon(url.page);
        app.clearTopBarIcons();
    };

    function $(id) {
        return document.getElementById(id);
    }

    document.addEventListener('deviceready', app.onDeviceReady, false);

})();